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
    return new Response(JSON.stringify({ error: 'Token de autenticación inválido.' }), { status: 401 });
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
    return new Response(JSON.stringify({ error: `Faltan variables de entorno: ${missingVars.join(', ')}` }), { status: 500 });
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

    const status = await imapClient.status('INBOX', { messages: true });
    console.log(`Encontrados ${status.messages} correos nuevos en la bandeja.`);
    
    const messagesToProcess = Math.min(status.messages, 50); // Límite de 50 correos
    
    // Busca y procesa los correos
    for (let i = 1; i <= messagesToProcess; i++) {
      const fetch = await imapClient.fetch(i, { envelope: true, body: true });
      
      const emailText = new TextDecoder().decode(fetch.body);
      const senderMatch = emailText.match(/From: ([^\n]+)/i);
      const subjectMatch = emailText.match(/Subject: ([^\n]+)/i);
      const bodyMatch = emailText.split('\n\n').slice(1).join('\n\n').trim();

      const emailData = {
        sender: senderMatch ? senderMatch[1].trim() : 'desconocido',
        subject: subjectMatch ? subjectMatch[1].trim() : 'Sin asunto',
        body: bodyMatch.substring(0, 5000), // Limita el cuerpo a 5000 caracteres
        source: 'imap_sync',
        status: 'new',
      };

      const { error: insertError } = await supabase.from('emails_sync').insert(emailData);

      if (insertError) {
        console.error(`Error insertando correo en Supabase: ${insertError.message}`);
        continue;
      }

      await imapClient.messageDelete(i);
      processedEmails.push({ subject: emailData.subject, index: i });
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
