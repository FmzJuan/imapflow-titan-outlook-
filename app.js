require('dotenv').config();
const { ImapFlow } = require('imapflow');
const fs = require('fs');
const path = require('path');
const util = require('util');

// --- ADICIONADO: Importando os módulos ---
const { reconstruirEmail } = require('./processadorEmail');
const { executarLimpezaMeta } = require('./limparMeta');
const { executarLimpezaLog } = require('./limparLog');

// CORREÇÃO: Declaração única do arquivo de log
const arquivoDeLog = path.join(__dirname, 'log.txt');
const logOriginal = console.log;
const errorOriginal = console.error;

function formatarDataHora(){
    return new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})
}

console.log = function (...args) {
    const mensagem = util.format(...args);
    const logFormatado = `[${formatarDataHora()}] [INFO] ${mensagem}\n`;
    fs.appendFileSync(arquivoDeLog, logFormatado);
    logOriginal.apply(console, args);
};

console.error = function (...args) {
    const mensagem = util.format(...args);
    const logFormatado = `[${formatarDataHora()}] [ERRO] ${mensagem}\n`;
    fs.appendFileSync(arquivoDeLog, logFormatado);
    errorOriginal.apply(console, args);
};

const CONTAS_OUTLOOK = [
    {
        id: 'USER1', // Fumi
        titan_email: process.env.TITAN_USER1,
        titan_password: process.env.TITAN_PASS_USER1,
        gmail_destino: process.env.GMAIL_USER1,
        gmail_pass: process.env.GMAIL_APP_PASS_USER1,
        dias_retencao: 10,
        pasta_drive_id: 'ID_PASTA_FUMI' // Adicione o ID aqui
    },
    {
        id: 'USER2', // Tuiane 
        titan_email: process.env.TITAN_USER2,
        titan_password: process.env.TITAN_PASS_USER2,
        gmail_destino: process.env.GMAIL_USER2,
        gmail_pass: process.env.GMAIL_APP_PASS_USER2,
        dias_retencao: 10,
        pasta_drive_id: 'ID_PASTA_TUIANE' // Adicione o ID aqui
    },
    {
        id: 'USER3', // Nacional - Clara
        titan_email: process.env.TITAN_USER3,
        titan_password: process.env.TITAN_PASS_USER3,
        gmail_destino: process.env.GMAIL_USER3,
        gmail_pass: process.env.GMAIL_APP_PASS_USER3,
        dias_retencao: 10,
        pasta_drive_id: 'ID_PASTA_CLARA' // Adicione o ID aqui
    }
];

const INTERVALO_MONITORAMENTO = 5 * 60 * 1000;
const LIMITE_TAMANHO_GMAIL = 35000000;

function carregarMeta(userId) {
    const filePath = path.join(__dirname, `meta_${userId}.json`);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
            console.error(`[AVISO] Erro ao ler cache do ${userId}.`, err.message);
            return {};
        }
    }
    return {};
}

function salvarMeta(userId, data) {
    const filePath = path.join(__dirname, `meta_${userId}.json`);
    const dataLimpa = executarLimpezaMeta(data, userId); // Chama o novo módulo de limpeza de meta
    fs.writeFileSync(filePath, JSON.stringify(dataLimpa, null, 2));
}

async function processarUsuario(user) {
    const meta = carregarMeta(user.id);
    const dataLimiteExclusao = new Date();
    dataLimiteExclusao.setDate(dataLimiteExclusao.getDate() - user.dias_retencao);

    const titan = new ImapFlow({
        host: 'imap.titan.email',
        port: 993,
        secure: true,
        auth: { user: user.titan_email, pass: user.titan_password },
        logger: false
    });

    const gmail = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: user.gmail_destino, pass: user.gmail_pass },
        logger: false
    });

    try {
        await titan.connect();
        await gmail.connect();
        
        let lock = await titan.getMailboxLock('INBOX');
        
        try {
            const messages = await titan.search({ all: true });
            console.log(`\n[${user.titan_email}] Sincronizando ${messages.length} mensagens...`);

            for (const uid of messages) {
                const { envelope, internalDate, flags, size } = await titan.fetchOne(uid, { envelope: true, internalDate: true, flags: true, size: true });
                
                const msgId = envelope.messageId;
                const assunto = envelope.subject || "(Sem assunto)";
                const dataEmail = new Date(internalDate);
                const jaLidoOriginalmente = flags.has('\\Seen'); 

                // ETAPA 1: LÓGICA DE CÓPIA/EMAGRECIMENTO
                if (!meta[msgId]) {
                    
                    if (size > LIMITE_TAMANHO_GMAIL) {
                        const tamanhoMB = (size / 1024 / 1024).toFixed(2);
                        console.log(`   -> [GIGANTE] "${assunto}" (${tamanhoMB} MB). Reduzindo via Drive...`);
                        
                        try {
                            const { source: sourceGigante } = await titan.fetchOne(uid, { source: true });
                            
                            // Processa o e-mail usando o ID da pasta do usuário
                            const sourceLeve = await reconstruirEmail(sourceGigante, user.pasta_drive_id);
                            
                            await gmail.append('INBOX', sourceLeve, []);
                            console.log(`   -> [SUCESSO] Versão reduzida enviada ao Gmail.`);

                            meta[msgId] = {
                                assunto: assunto,
                                dataRecebimento: internalDate,
                                copiadoEm: new Date().toISOString(),
                                reduzido: true,
                                excluidoDoTitan: false
                            };
                        } catch (errDrive) {
                            console.error(`   [ERRO DRIVE] Falha ao reduzir "${assunto}":`, errDrive.message);
                            continue; // Tenta no próximo ciclo
                        }
                    } else {
                        // Fluxo normal para e-mails pequenos
                        const { source } = await titan.fetchOne(uid, { source: true });
                        try {
                            await gmail.append('INBOX', source, []);
                            console.log(`   -> [COPIADO] "${assunto}"`);
                            
                            meta[msgId] = {
                                assunto: assunto,
                                dataRecebimento: internalDate,
                                copiadoEm: new Date().toISOString(),
                                excluidoDoTitan: false
                            };
                        } catch (errGmail) {
                            console.error(`   [ERRO GMAIL] Falha ao copiar:`, errGmail.message);
                            continue;
                        }
                    }

                    salvarMeta(user.id, meta);

                    // Devolve o status de "Não Lido" se necessário
                    if (!jaLidoOriginalmente) {
                        await titan.messageFlagsRemove(uid, ['\\Seen']);
                    }
                }

                // ETAPA 2: LÓGICA DE EXCLUSÃO (Data de Corte)
                if (meta[msgId] && !meta[msgId].excluidoDoTitan && dataEmail < dataLimiteExclusao) {
                    await titan.messageFlagsAdd(uid, ['\\Deleted']);
                    meta[msgId].excluidoDoTitan = true;
                    meta[msgId].dataExclusao = new Date().toISOString();
                    salvarMeta(user.id, meta);
                    console.log(`   -> [LIMPANDO] "${assunto}" removido do Titan (Retenção ${user.dias_retencao} dias).`);
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
    console.log("===[SISTEMA DE ARQUIVAMENTO HÍBRIDO BLINDADO INICIADO]===");
    while (true) {
        for (const user of CONTAS_OUTLOOK) {
            await processarUsuario(user);
        }
        
        // Após processar todos, limpa o log geral
        await executarLimpezaLog(arquivoDeLog);
        
        console.log(`\nCiclo completo. Aguardando...`);
        await new Promise(r => setTimeout(r, INTERVALO_MONITORAMENTO));
    }
}

monitorar();