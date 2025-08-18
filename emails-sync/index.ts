import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import Pop3Command from "npm:node-pop3";
Deno.serve(async (req)=>{
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
  const missingVars = requiredEnvVars.filter((varName)=>!Deno.env.get(varName));
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
    const pop3 = new Pop3Command({
      host: 'pop.gmail.com',
      port: 995,
      enabletls: true,
      user: GMAIL_EMAIL,
      password: GMAIL_APP_PASSWORD
    });
    await pop3.connect();
    console.log('Conexión POP3 establecida exitosamente');
    const statInfo = await pop3.command('STAT');
    const numMessages = parseInt(statInfo.split(' ')[0], 10);
    console.log(`Encontrados ${numMessages} correos nuevos en el buzón.`);
    const processedEmails = [];
    // Límite de seguridad para evitar procesar demasiados correos
    const MAX_EMAILS = 50;
    const messagesToProcess = Math.min(numMessages, MAX_EMAILS);
    for(let i = 1; i <= messagesToProcess; i++){
      try {
        const fullEmail = await pop3.command('RETR', i);
        const emailText = fullEmail.toString();
        const senderMatch = emailText.match(/From: ([^\n]+)/i);
        const subjectMatch = emailText.match(/Subject: ([^\n]+)/i);
        const body = emailText.split('\r\n\r\n')[1]?.trim() || '';
        const emailData = {
          sender: senderMatch ? senderMatch[1].trim() : 'Remitente desconocido',
          subject: subjectMatch ? subjectMatch[1].trim() : 'Sin asunto',
          body: body.substring(0, 5000),
          source: 'pop3_sync',
          status: 'new',
          received_at: new Date().toISOString()
        };
        const { error: insertError } = await supabase.from('emails_sync').insert(emailData);
        if (insertError) {
          console.error(`Error insertando correo ${i}: ${insertError.message}`);
          continue; // Salta al siguiente correo en caso de error
        }
        // Eliminar correo solo si la inserción fue exitosa
        await pop3.command('DELE', i);
        processedEmails.push({
          subject: emailData.subject,
          index: i
        });
      } catch (emailError) {
        console.error(`Error procesando correo ${i}:`, emailError);
      }
    }
    await pop3.command('QUIT');
    return new Response(JSON.stringify({
      success: true,
      message: `Procesados ${processedEmails.length} correos.`,
      details: processedEmails
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  } catch (syncError) {
    console.error('Error crítico en sincronización POP3:', syncError);
    return new Response(JSON.stringify({
      success: false,
      error: 'Error en sincronización POP3',
      details: syncError.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
});