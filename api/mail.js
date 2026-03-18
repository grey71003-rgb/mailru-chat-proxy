const nodemailer = require('nodemailer');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const MAIL_CONFIG = {
  user: 'chat-helloworld@mail.ru',
  password: 'Uw5dyegGhHQaVwtagSvP',
  
  smtp: {
    host: 'smtp.mail.ru',
    port: 465,
    secure: true,
    auth: {
      user: 'chat-helloworld@mail.ru',
      pass: 'Uw5dyegGhHQaVwtagSvP'
    }
  },
  
  imap: {
    user: 'chat-helloworld@mail.ru',
    password: 'Uw5dyegGhHQaVwtagSvP',
    host: 'imap.mail.ru',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  }
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { action } = req.query;
  const { user, text, image } = req.body || {};

  try {
    // ========== ТЕСТ ==========
    if (action === 'test') {
      const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
      await transporter.verify();
      return res.status(200).json({ ok: true, message: 'SMTP работает!' });
    }
    
    // ========== ОТПРАВКА ==========
    else if (action === 'send') {
      const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
      
      await transporter.sendMail({
        from: MAIL_CONFIG.user,
        to: MAIL_CONFIG.user,
        subject: `📱 ${user}`,
        text: text || '',
        html: image ? `${text}<br><img src="${image}" style="max-width:300px">` : text,
        headers: {
          'X-Chat-Message': 'true',
          'X-Chat-User': user
        }
      });
      
      return res.status(200).json({ ok: true, message: 'Отправлено' });
    }
    
    // ========== ПОЛУЧЕНИЕ ИЗ ВСЕХ ПАПОК ==========
    else if (action === 'get') {
      const messages = await getAllMessages();
      return res.status(200).json({ 
        ok: true, 
        messages: messages.slice(-50), // последние 50
        total: messages.length
      });
    }
    
    else {
      return res.status(200).json({ 
        ok: true, 
        message: 'Доступные действия: test, send, get' 
      });
    }
    
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).json({ error: error.message });
  }
};

// ========== НОВЫЕ ФУНКЦИИ ДЛЯ ЧТЕНИЯ ВСЕХ ПАПОК ==========

// Функция для получения писем из конкретной папки
function getMessagesFromFolder(folderName) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(MAIL_CONFIG.imap);
    const messages = [];
    
    imap.once('ready', () => {
      imap.openBox(folderName, false, (err, box) => {
        if (err) {
          console.log(`❌ Не удалось открыть папку ${folderName}:`, err.message);
          resolve([]);
          return;
        }
        
        console.log(`📬 Читаем папку ${folderName}, писем: ${box.messages.total}`);
        
        imap.search(['ALL'], (err, results) => {
          if (err) {
            resolve([]);
            return;
          }
          
          const lastMessages = results.slice(-30);
          
          if (lastMessages.length === 0) {
            imap.end();
            resolve([]);
            return;
          }
          
          let processed = 0;
          const fetch = imap.fetch(lastMessages, { bodies: '' });
          
          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, async (err, parsed) => {
                if (err) return;
                
                // Определяем отправителя
                let from = 'Неизвестный';
                
                // Сначала проверяем заголовок X-Chat-User
                if (parsed.headers && parsed.headers['x-chat-user']) {
                  from = parsed.headers['x-chat-user'];
                }
                // Если нет, берем из темы
                else if (parsed.subject && parsed.subject.includes('📱')) {
                  from = parsed.subject.replace('📱', '').trim();
                }
                // Если ничего не нашли, берем из From
                else if (parsed.from && parsed.from.text) {
                  from = parsed.from.text.split('<')[0].trim() || 'Неизвестный';
                }
                
                messages.push({
                  id: parsed.messageId || Date.now() + Math.random(),
                  user: from,
                  text: parsed.text || parsed.subject || '...',
                  time: parsed.date || new Date().toISOString(),
                  folder: folderName // добавляем имя папки для отладки
                });
                
                processed++;
                if (processed === lastMessages.length) {
                  imap.end();
                }
              });
            });
          });
          
          fetch.once('end', () => {
            resolve(messages);
          });
          
          fetch.once('error', (err) => {
            resolve([]);
          });
        });
      });
    });
    
    imap.once('error', (err) => {
      console.log(`❌ Ошибка подключения к ${folderName}:`, err.message);
      resolve([]);
    });
    
    imap.connect();
  });
}

// Функция для получения писем из ВСЕХ папок
async function getAllMessages() {
  // Список папок для чтения (разные названия для разных языков)
  const folders = [
    'INBOX',           // Входящие
    'Sent',            // Отправленные (англ)
    'Отправленные',    // Отправленные (рус)
    'Drafts',          // Черновики (англ)
    'Черновики',       // Черновики (рус)
    'Письма себе'      // Письма себе
  ];
  
  let allMessages = [];
  
  // Читаем каждую папку
  for (const folder of folders) {
    const messages = await getMessagesFromFolder(folder);
    allMessages = [...allMessages, ...messages];
  }
  
  // Сортируем по времени (старые сверху, новые снизу)
  allMessages.sort((a, b) => new Date(a.time) - new Date(b.time));
  
  return allMessages;
}
