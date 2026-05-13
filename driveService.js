const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const stream = require('stream');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credenciais-oauth.json');

async function getClient() {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const credentials = JSON.parse(content);
    
    // O Google muda o nome da chave pai dependendo do tipo de credencial
    const config = credentials.installed || credentials.web;
    
    if (!config) {
        throw new Error('Arquivo de credenciais inválido: certifique-se de usar um ID de cliente OAuth 2.0.');
    }

    const { client_secret, client_id, redirect_uris } = config;
    
    // Para aplicativos de desktop, usamos o primeiro redirect_uri da lista
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    try {
        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (err) {
        return getNewToken(oAuth2Client);
    }
}

async function getNewToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
    console.log('\n--- 🔑 AUTORIZAÇÃO NECESSÁRIA ---');
    console.log('1. Abra este link no navegador:', authUrl);
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('2. Cole o código de autorização aqui: ', async (code) => {
            rl.close();
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
            console.log('Token armazenado em:', TOKEN_PATH);
            resolve(oAuth2Client);
        });
    });
}

async function uploadParaDrive(buffer, filename, mimeType, idDaPasta) {
    try {
        const auth = await getClient();
        const drive = google.drive({ version: 'v3', auth });

        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const fileMetadata = { name: filename, parents: [idDaPasta] };
        const media = { mimeType: mimeType, body: bufferStream };

        const file = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id, webViewLink'
        });

        return file.data.webViewLink;
    } catch (error) {
        console.error(`[ERRO DRIVE] Falha no upload de ${filename}:`, error.message);
        throw error;
    }
}

module.exports = { uploadParaDrive };