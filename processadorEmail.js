const simpleParser = require('mailparser').simpleParser;
const MailComposer = require('nodemailer/lib/mail-composer');
const { uploadParaDrive } = require('./driveService');

const LIMITE_ANEXO_DRIVE = 10000000; // 10MB

async function reconstruirEmail(sourceBruto, idDaPasta) {
    const parsedMail = await simpleParser(sourceBruto);
    let novoHtml = parsedMail.html || parsedMail.textAsHtml || `<p>${parsedMail.text}</p>`;
    let anexosParaManter = [];
    let linksDoDrive = [];

    if (parsedMail.attachments) {
        for (let anexo of parsedMail.attachments) {
            if (anexo.size > LIMITE_ANEXO_DRIVE) {
                // Passa o ID da pasta dinâmica aqui
                const link = await uploadParaDrive(anexo.content, anexo.filename, anexo.contentType, idDaPasta);
                linksDoDrive.push({ nome: anexo.filename, link: link });
            } else {
                anexosParaManter.push({
                    filename: anexo.filename,
                    content: anexo.content,
                    contentType: anexo.contentType,
                    cid: anexo.cid,
                    contentDisposition: anexo.contentDisposition
                });
            }
        }
    }

    if (linksDoDrive.length > 0) {
        let caixaAviso = `
        <div style="background-color: #fff3cd; border: 1px solid #ffeeba; padding: 15px; border-radius: 5px; margin-bottom: 20px; font-family: sans-serif; color: #856404;">
            <strong>📎 Anexos movidos para o Drive Investur:</strong><br>
            <ul style="margin: 10px 0 0 0;">`;
        linksDoDrive.forEach(item => {
            caixaAviso += `<li><a href="${item.link}">${item.nome}</a></li>`;
        });
        caixaAviso += `</ul></div>`;
        novoHtml = caixaAviso + novoHtml;
    }

    const mailOptions = {
        from: parsedMail.from?.text,
        to: parsedMail.to?.text,
        cc: parsedMail.cc?.text,
        subject: parsedMail.subject,
        date: parsedMail.date,
        html: novoHtml,
        attachments: anexosParaManter,
        headers: {
            'Message-ID': parsedMail.messageId,
            'In-Reply-To': parsedMail.inReplyTo,
            'References': parsedMail.references
        }
    };

    return new MailComposer(mailOptions).compile().build();
}

module.exports = { reconstruirEmail };