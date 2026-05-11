require('dotenv').config();
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');
const util = require('util');

//sistema de log .txt 
const arquivoDeLog = path.join(__dirname, 'log.txt');
const logOriginal = console.log;
const errorOriginal = console.error;

function formatarDataHora(){
    return new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
}
// Intercepta os console.log normais
console.log = function (...args) {
    const mensagem = util.format(...args);
    // Cria a linha com Data, Hora e a mensagem
    const logFormatado = `[${formatarDataHora()}] [INFO] ${mensagem}\n`;
    
    fs.appendFileSync(arquivoDeLog, logFormatado); // Salva no arquivo
    logOriginal.apply(console, args);              // Mostra na tela
};

// Intercepta os console.error
console.error = function (...args) {
    const mensagem = util.format(...args);
    const logFormatado = `[${formatarDataHora()}] [ERRO] ${mensagem}\n`;
    
    fs.appendFileSync(arquivoDeLog, logFormatado); // Salva no arquivo
    errorOriginal.apply(console, args);            // Mostra na tela
};

// 1. CONFIGURAÇÃO INDIVIDUAL DE USUÁRIOS
const CONTAS_OUTLOOK = [
    /*{
        id: 'USER1', //Fumi
        titan_email: process.env.TITAN_USER1,
        titan_password: process.env.TITAN_PASS_USER1,
        gmail_destino: process.env.GMAIL_USER1,
        gmail_pass: process.env.GMAIL_APP_PASS_USER1,
        dias_retencao: 10
    },
    {
        id: 'USER2', // Tuiane 
        titan_email: process.env.TITAN_USER2,
        titan_password: process.env.TITAN_PASS_USER2,
        gmail_destino: process.env.GMAIL_USER2,
        gmail_pass: process.env.GMAIL_APP_PASS_USER2,
        dias_retencao: 10
    },*/
    {
        id: 'USER3', // Nacional - Clara
        titan_email: process.env.TITAN_USER3,
        titan_password: process.env.TITAN_PASS_USER3,
        gmail_destino: process.env.GMAIL_USER3,
        gmail_pass: process.env.GMAIL_APP_PASS_USER3,
        dias_retencao: 4 
    }
];

const INTERVALO_MONITORAMENTO = 5 * 60 * 1000; // 5 minutos

// 2. FUNÇÕES DE DISCO (Resiliência contra queda de energia)
function carregarMeta(userId) {
    const filePath = path.join(__dirname, `meta_${userId}.json`);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error(`[AVISO] Erro ao ler cache do ${userId}. Iniciando um novo.`, err.message);
            return {};
        }
    }
    return {};
}

function salvarMeta(userId, data) {
    const filePath = path.join(__dirname, `meta_${userId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function processarUsuario(user) {
    const meta = carregarMeta(user.id);
    
    const dataLimiteExclusao = new Date();
    dataLimiteExclusao.setDate(dataLimiteExclusao.getDate() - user.dias_retencao);

    // Conexões estabelecidas no padrão do seu código antigo (mais estável)
    const titan = new ImapFlow({
        host: 'imap.titan.email',
        port: 993,
        secure: true,
        auth: { user: user.titan_email, pass: user.titan_password },
        logger: false
    });
    titan.on('error', err => console.error(`[ERRO SILENCIOSO TITAN - ${user.titan_email}]:`, err.message));

    const gmail = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: user.gmail_destino, pass: user.gmail_pass },
        logger: false
    });
    gmail.on('error', err => console.error(`[ERRO SILENCIOSO GMAIL - ${user.gmail_destino}]:`, err.message));

    try {
        await titan.connect();
        await gmail.connect(); // Já conectamos no Gmail de cara, evitando perda de sessão
        
        let lock = await titan.getMailboxLock('INBOX');
        
        try {
            const messages = await titan.search({ all: true });
            console.log(`\n[${user.titan_email} - Regra: ${user.dias_retencao} dias] Analisando ${messages.length} mensagens...`);

            for (const uid of messages) {
                const { envelope, internalDate, flags } = await titan.fetchOne(uid, { envelope: true, internalDate: true, flags: true });
                
                const msgId = envelope.messageId;
                const assunto = envelope.subject || "(Sem assunto)";
                const dataEmail = new Date(internalDate);
                const jaLidoOriginalmente = flags.has('\\Seen'); 

                // --- ETAPA 1: LÓGICA DE CÓPIA ---
                if (!meta[msgId]) {
                    const { source } = await titan.fetchOne(uid, { source: true });

                    try {
                        // USANDO A TÉCNICA DO SEU CÓDIGO ANTIGO: array vazio [] para o Gmail aceitar direto sem reclamar
                        await gmail.append('INBOX', source, []);
                        console.log(`   -> [COPIADO] "${assunto}"`);
                        
                        meta[msgId] = {
                            assunto: assunto,
                            dataRecebimento: internalDate,
                            copiadoEm: new Date().toISOString(),
                            excluidoDoTitan: false
                        };
                        salvarMeta(user.id, meta);

                        // Proteção do Outlook: Remove o status de lido lá no Titan para o usuário ver como Novo
                        if (!jaLidoOriginalmente) {
                            await titan.messageFlagsRemove(uid, ['\\Seen']);
                        }

                    } catch (err) {
                        console.error(`   [ERRO CÓPIA GMAIL] ${user.id}:`, err.message);
                        continue; 
                    }
                }

                // --- ETAPA 2: LÓGICA DE EXCLUSÃO (Data de Corte) ---
                if (meta[msgId] && !meta[msgId].excluidoDoTitan && dataEmail < dataLimiteExclusao) {
                    await titan.messageFlagsAdd(uid, ['\\Deleted']);
                    
                    meta[msgId].excluidoDoTitan = true;
                    meta[msgId].dataExclusao = new Date().toISOString();
                    salvarMeta(user.id, meta);
                    
                    console.log(`   -> [LIMPANDO] "${assunto}" atingiu o limite de ${user.dias_retencao} dias. Removido.`);
                }
            }

            await titan.mailboxClose();

        } finally {
            if (lock) lock.release();
        }
    } catch (err) {
        console.error(`Erro na conta ${user.titan_email}:`, err.message);
    } finally {
        if (gmail.usable) await gmail.logout();
        if (titan.usable) await titan.logout();
    }
}

async function monitorar() {
    console.log("===[DEV-J] SISTEMA DE ARQUIVAMENTO HÍBRIDO MULTI-REGRAS INICIADO - OUTLOOK E GMAIL ===");
    console.log("-> Proteção contra reinicialização: ATIVADA");
    console.log("-> Tempos de retenção individuais: ATIVADOS (Lendo array de configurações)");
    console.log("-> Proteção de status 'Não Lido': ATIVADA\n");

    while (true) {
        for (const user of CONTAS_OUTLOOK) {
            await processarUsuario(user);
        }
        console.log(`\nCiclo completo. Aguardando ${INTERVALO_MONITORAMENTO/60000} minutos...`);
        await new Promise(r => setTimeout(r, INTERVALO_MONITORAMENTO));
    }
}

monitorar();