import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { ImapFlow } from 'npm:imapflow';

Deno.serve(async (req) => {
  // Validación de método
  if (req.method !== 'POST') {
    return new Response('Método no permitido', {
      status: 405
    });
  }
  // Validación de secreto mejorada
  const authHeader = req.headers.get('Authorization');
  const secretToken = Deno.env.get('SYNC_API_SECRET');
  if (!authHeader || !secretToken) {
    console.error('Falta token de autenticación o secreto');
    return new Response(JSON.stringify({
      error: 'Configuración de autenticación incompleta'
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  // Validación más estricta del token
  if (!authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== secretToken) {
    console.error('Token de autenticación inválido');
    return new Response(JSON.stringify({
      error: 'Token de autenticación inválido'
    }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  // Validación de variables de entorno
  const requiredEnvVars = [
    'GMAIL_EMAIL',
    'GMAIL_APP_PASSWORD',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  const missingVars = requiredEnvVars.filter((varName) => !Deno.env.get(varName));
  if (missingVars.length > 0) {
    console.error(`Variables de entorno faltantes: ${missingVars.join(', ')}`);
    return new Response(JSON.stringify({
      error: `Faltan variables de entorno: ${missingVars.join(', ')}`
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
  const GMAIL_EMAIL = Deno.env.get('GMAIL_EMAIL');
  const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const imapClient = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: GMAIL_EMAIL,
        pass: GMAIL_APP_PASSWORD,
      },
    });

    await imapClient.connect();
    console.log('Conexión IMAP establecida exitosamente');
    
    // Selecciona la bandeja de entrada
    let lock = await imapClient.get);
    try {
        const status = await imapClient.status('INBOX', { messages: true });
        console.log(`Encontrados ${status.messages} correos nuevos en la bandeja.`);
    } finally {
        lock.release();
    }

    const processedEmails = [];
    // Busca correos no leídos
    const messages = await imapClient.fetch('1:*', { envelope: true });
    
    for (const msg of messages) {
      console.log(`Encontrado un correo: ${msg.envelope.subject}`);
      
      const sender = msg.envelope.from[0].address;
      const subject = msg.envelope.subject;
      
      // Nota: Aquí se necesitaría un paso adicional para obtener el cuerpo del correo.
      // Por simplicidad, solo guardaremos el asunto y el remitente.
      
      const emailData = {
        sender: sender,
        subject: subject,
        body: '', // No tenemos el cuerpo, lo dejamos vacío por ahora
        source: 'imap_sync',
        status: 'new',
      };
      
      const { error: insertError } = await supabase.from('emails_sync').insert(emailData);

      if (insertError) {
        console.error(`Error insertando correo en Supabase: ${insertError.message}`);
        continue; // Salta al siguiente correo en caso de error
      }
      
      processedEmails.push({ subject: emailData.subject });
    }

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
