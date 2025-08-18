import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { ImapFlow } from 'npm:imapflow';
import { simpleParser } from 'npm:mailparser';

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
    const { data: syncData, error: syncError } = await supabase
      .from('sync_state')
      .select('last_run, id')
      .single();

    if (syncError || !syncData) {
      console.error('Error al leer el estado de sincronización:', syncError);
      throw new Error('No se pudo obtener la última fecha de ejecución de la base de datos.');
    }

    const lastRunDate = new Date(syncData.last_run);
    console.log(`Última ejecución registrada en Supabase: ${lastRunDate}`);

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
    
    await imapClient.mailboxOpen('INBOX');

    const uids = await imapClient.search({ since: lastRunDate });
    
    if (uids.length === 0) {
        console.log('No hay correos nuevos para procesar.');
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
    let lastProcessedTimestamp;

    const messages = imapClient.fetch(uids, { envelope: true, body: true, source: true });
    
    for await (const msg of messages) {
      console.log(`Procesando correo con UID: ${msg.uid}`);
      
      let emailText = '';
      if (msg.source) {
        const parsed = await simpleParser(msg.source);
        emailText = parsed.text || parsed.html || '';
      }
      
      const emailData = {
        sender: msg.envelope.from[0].address,
        subject: msg.envelope.subject,
        body: emailText.substring(0, 5000),
        source: 'imap_sync',
        status: 'new',
      };
      
      const { error: insertError } = await supabase.from('emails_sync').insert(emailData);
      
      if (insertError) {
        console.error(`Error insertando correo en Supabase: ${insertError.message}`);
        continue;
      }
      
      // ---- INICIO DE LA NUEVA LÓGICA PARA MOVER EL CORREO A LA PAPELERA ----
      try {
        await imapClient.messageMove(msg.uid, '[Gmail]/Trash');
        console.log(`Correo con UID ${msg.uid} movido a la papelera.`);
      } catch (moveError) {
        console.error(`Error al mover el correo con UID ${msg.uid}: ${moveError.message}`);
      }
      // ---- FIN DE LA NUEVA LÓGICA ----
      
      processedEmails.push({ subject: emailData.subject, uid: msg.uid });
      lastProcessedTimestamp = msg.envelope.date;
    }
    
    if (lastProcessedTimestamp) {
        const { error: updateError } = await supabase
            .from('sync_state')
            .update({ last_run: lastProcessedTimestamp })
            .eq('id', syncData.id);
        
        if (updateError) {
            console.error('Error al actualizar la fecha de sincronización:', updateError);
        }
    }

    console.log(`Procesados ${processedEmails.length} correos.`);

    return new Response(JSON.stringify({
      success: true,
      message: `Procesados y movidos ${processedEmails.length} correos de IMAP.`,
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
  } finally {
    if (imapClient && imapClient.isConnected) {
        await imapClient.logout();
        console.log('Conexión IMAP cerrada.');
    }
  }
});
