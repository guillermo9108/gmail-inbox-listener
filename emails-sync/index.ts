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
      logLevel: 'debug' // Esto nos ayudará a ver más detalles si algo falla
    });

    await imapClient.connect();
    console.log('Conexión IMAP establecida exitosamente');
    
    // Aquí puedes agregar la lógica para procesar correos.
    // Por ahora, solo nos aseguraremos de que la conexión funcione.
    
    await imapClient.logout();
    return new Response(JSON.stringify({
      success: true,
      message: 'Conexión IMAP probada exitosamente. ¡Listo para procesar correos!',
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
