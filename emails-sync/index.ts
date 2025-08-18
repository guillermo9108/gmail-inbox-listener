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
    
    // Obtiene el lock de la bandeja de entrada
    let lock = await imapClient.getLock('INBOX');

    try {
        const status = await imapClient.status('INBOX', { messages: true });
        console.log(`Encontrados ${status.messages} correos nuevos en la bandeja.`);
        
        const processedEmails = [];
        // Busca correos no leídos
        const messages = imapClient.fetch('1:*', { envelope: true });
        
        for await (const msg of messages) {
          console.log(`Encontrado un correo: ${msg.envelope.subject}`);
          
          const sender = msg.envelope.from[0].address;
          const subject = msg.envelope.subject;
          
          const emailData = {
            sender: sender,
            subject: subject,
            body: '', // Se podría añadir el cuerpo con otro comando
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
    } finally {
        lock.release(); // Libera el lock
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
