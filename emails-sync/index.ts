import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { ImapFlow } from 'npm:imapflow';

Deno.serve(async (req) => {
  // Validación de método
  if (req.method !== 'POST') {
    return new Response('Método no permitido', {
      status: 405
    });
  }
  // Validación de secreto
  const authHeader = req.headers.get('Authorization');
  const secretToken = Deno.env.get('SYNC_API_SECRET');
  if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== secretToken) {
    return new Response(JSON.stringify({
      error: 'Token de autenticación inválido.'
    }), {
      status: 401
    });
  }

  // Validación de variables de entorno
  const requiredEnvVars = [
    'GMAIL_EMAIL',
    'GMAIL_APP_PASSWORD',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  const missingVars = requiredEnvVars.filter(varName => !Deno.env.get(varName));
  if (missingVars.length > 0) {
    return new Response(JSON.stringify({
      error: `Faltan variables de entorno: ${missingVars.join(', ')}`
    }), {
      status: 500
    });
  }

  const GMAIL_EMAIL = Deno.env.get('GMAIL_EMAIL');
  const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let imapClient;
  try {
    imapClient = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: GMAIL_EMAIL,
        pass: GMAIL_APP_PASSWORD,
      },
      logLevel: 'debug'
    });

    await imapClient.connect();
    console.log('Conexión IMAP establecida exitosamente');
    
    // Abre la bandeja de entrada
    await imapClient.mailboxOpen('INBOX');

    // Busca UIDs de correos no leídos y limita a 50
    const uids = await imapClient.search('UNSEEN', { limit: 50 });
    
    if (uids.length === 0) {
        console.log('No hay correos nuevos para procesar.');
        await imapClient.logout();
        return new Response(JSON.stringify({
            success: true,
            message: 'No hay correos nuevos para procesar.'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    console.log(`Encontrados ${uids.length} correos nuevos.`);
    
    const processedEmails = [];
    
    // Descarga los mensajes
    const messages = imapClient.fetch(uids, { envelope: true, body: true, source: true });
    
    // Y luego los procesamos
    for await (const msg of messages) {
      console.log(`Procesando correo con UID: ${msg.uid}`);
      
      const emailText = new TextDecoder().decode(msg.body);
      const emailData = {
        sender: msg.envelope.from[0].address,
        subject: msg.envelope.subject,
        body: emailText.substring(0, 5000), // Limita el cuerpo a 5000 caracteres
        source: 'imap_sync',
        status: 'new',
      };
      
      const { error: insertError } = await supabase.from('emails_sync').insert(emailData);
      
      if (insertError) {
        console.error(`Error insertando correo en Supabase: ${insertError.message}`);
        continue;
      }
      
      // Marca el correo como visto para que no se procese de nuevo
      await imapClient.messageFlags(msg.uid, {
        add: 'SEEN'
      });

      processedEmails.push({ subject: emailData.subject, uid: msg.uid });
    }

    console.log(`Procesados ${processedEmails.length} correos.`);

    await imapClient.logout();
    return new Response(JSON.stringify({
      success: true,
      message: `Procesados ${processedEmails.length} correos de IMAP.`,
      details: processedEmails
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (syncError) {
    console.error('Error crítico en sincronización IMAP:', syncError);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error en sincronización IMAP',
      details: syncError.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});
