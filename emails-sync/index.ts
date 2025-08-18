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

    const processedEmails = [];
    
    // Abre la bandeja de entrada para procesar los correos
    await imapClient.mailboxOpen('INBOX');

    const messages = imapClient.fetch('1:*', { envelope: true, body: true });
    
    // Usamos 'for await' para un manejo correcto de la librería
    for await (const msg of messages) {
      console.log(`Encontrado un correo: ${msg.envelope.subject}`);
      
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
      
      // Eliminamos el mensaje usando su UID, que es más confiable que el índice.
      await imapClient.messageDelete(msg.uid);
      processedEmails.push({ subject: emailData.subject, index: msg.uid });
    }

    // Usamos 'expunge' para purgar los correos eliminados del servidor.
    await imapClient.expunge();
    
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
