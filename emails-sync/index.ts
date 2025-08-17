// Tu función de Supabase: se encarga de la conexión a Gmail y la inserción en la base de datos.
import { createClient } from 'npm:@supabase/supabase-js@2.39.3';
import { Client as POP3Client } from "https://deno.land/x/pop3_client_deno@v1.0.2/mod.ts";

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Método no permitido', { status: 405 });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const secretToken = Deno.env.get('SYNC_API_SECRET');
    if (!authHeader || !authHeader.startsWith('Bearer ') || authHeader.split(' ')[1] !== secretToken) {
      return new Response(JSON.stringify({ error: 'Token de autenticación inválido.' }), { status: 401 });
    }

    const GMAIL_EMAIL = Deno.env.get('GMAIL_EMAIL');
    const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GMAIL_EMAIL || !GMAIL_APP_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Faltan variables de entorno para la configuración.');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let pop3Client;
    const processedEmails = [];

    try {
      pop3Client = await POP3Client.connect({
        host: 'pop.gmail.com',
        port: 995,
        tls: true,
        user: GMAIL_EMAIL,
        password: GMAIL_APP_PASSWORD,
      });

      await pop3Client.auth();
      const emailCount = await pop3Client.stat();
      console.log(`Encontrados ${emailCount.count} correos nuevos en el buzón.`);

      for (let i = 1; i <= emailCount.count; i++) {
        const fullEmail = await pop3Client.retr(i);
        const emailText = new TextDecoder().decode(fullEmail.data);
        const senderMatch = emailText.match(/From: ([^\n]+)/i);
        const subjectMatch = emailText.match(/Subject: ([^\n]+)/i);
        const body = emailText.split('\n\n').slice(1).join('\n\n').trim();

        const emailData = {
          sender: senderMatch ? senderMatch[1].trim() : 'desconocido',
          subject: subjectMatch ? subjectMatch[1].trim() : 'Sin asunto',
          body: body.substring(0, 5000),
          source: 'pop3_sync',
          status: 'new',
        };

        const { error: insertError } = await supabase.from('emails_sync').insert(emailData);

        if (insertError) {
          throw new Error(`Error insertando correo en Supabase: ${insertError.message}`);
        }

        await pop3Client.dele(i);
        processedEmails.push({ subject: emailData.subject });
      }
    } catch (syncError) {
      console.error('Error en sincronización POP3:', syncError.message);
      return new Response(JSON.stringify({ success: false, error: syncError.message }), { status: 500 });
    } finally {
      if (pop3Client) {
        await pop3Client.quit();
      }
    }

    return new Response(JSON.stringify({ success: true, message: `Procesados ${processedEmails.length} correos.` }), { status: 200 });

  } catch (error) {
    console.error('Error general en la función:', error.message);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
});
