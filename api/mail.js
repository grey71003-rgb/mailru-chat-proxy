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
  const { user, text, image, room = 'general' } = req.body || {};

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
      
      // Формируем тему письма в зависимости от комнаты
      const subject = `[${room}] ${user}`;
      
      // Формируем текст письма
      let htmlContent = text || '';
      if (image) {
        htmlContent += `<br><img src="${image}" style="max-width: 100%;">`;
      }
      
      await transporter.sendMail({
        from: MAIL_CONFIG.user,
        to: MAIL_CONFIG.user,
        subject: subject,
        text: text || '',
        html: htmlContent,
        headers: {
          'X-Chat-Room': room,
          'X-Chat-User': user
        }
      });
      
      return res.status(200).json({ ok: true, message: 'Отправлено' });
    }
    
    // ========== ПОЛУЧЕНИЕ ИЗ ВСЕХ ПАПОК ==========
    else if (action === 'get') {
      // Список папок для чтения
      const folders = ['INBOX', 'Отправленные', 'Письма себе', 'Sent', 'Drafts'];
      let allMessages = [];
      
      for (const folder of folders) {
        try {
          const folderMessages = await getMessagesFromFolder(folder);
          allMessages = [...allMessages, ...folderMessages];
          console.log(`📬 Папка ${folder}: ${folderMessages.length} писем`);
        } catch (e) {
          console.log(`❌ Ошибка чтения ${folder}:`, e.message);
        }
      }
      
      // Сортируем по времени
      allMessages.sort((a, b) => new Date(a.time) - new Date(b.time));
      
      // Фильтруем по комнате если указана
      if (room && room !== 'all') {
        allMessages = allMessages.filter(msg => msg.room === room || msg.room === 'general');
      }
      
      return res.status(200).json({ 
        ok: true, 
        messages: allMessages.slice(-50), // последние 50
        total: allMessages.length
      });
    }
    
    // ========== ПОЛУЧЕНИЕ СПИСКА ПАПОК ==========
    else if (action === 'folders') {
      const folders = await getFolders();
      return res.status(200).json({ ok: true, folders });
    }
    
    else {
      return res.status(200).json({ 
        ok: true, 
        message: 'Доступные действия: test, send, get, folders' 
      });
    }
    
  } catch (error) {
    console.error('Ошибка:', error);
    return res.status(500).json({ error: error.message });
  }
};

// Функция для получения списка папок
function getFolders() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(MAIL_CONFIG.imap);
    
    imap.once('ready', () => {
      imap.getBoxes((err, boxes) => {
        if (err) {
          reject(err);
          return;
        }
        
        const folderList = [];
        
        function listBoxes(boxes, path = '') {
          for (let name in boxes) {
            const fullPath = path ? `${path}/${name}` : name;
            folderList.push(fullPath);
            if (boxes[name].children) {
              listBoxes(boxes[name].children, fullPath);
            }
          }
        }
        
        listBoxes(boxes);
        imap.end();
        resolve(folderList);
      });
    });
    
    imap.once('error', (err) => {
      reject(err);
    });
    
    imap.connect();
  });
}

// Функция для получения писем из конкретной папки
function getMessagesFromFolder(folderName) {
  return new Promise((resolve, reject) => {
    const imap = new Imap(MAIL_CONFIG.imap);
    const messages = [];
    
    imap.once('ready', () => {
      // Пробуем открыть папку
      imap.openBox(folderName, false, (err, box) => {
        if (err) {
          // Если папка не существует, пробуем другие варианты названия
          const alternatives = {
            'Письма себе': ['Письма себе', 'Self', 'Drafts'],
            'Отправленные': ['Отправленные', 'Sent', 'Sent Messages'],
            'INBOX': ['INBOX', 'Входящие', 'Inbox']
          };
          
          const altList = alternatives[folderName] || [folderName];
          tryNextFolder(0);
          
          function tryNextFolder(index) {
            if (index >= altList.length) {
              imap.end();
              resolve([]);
              return;
            }
            
            imap.openBox(altList[index], false, (err2, box2) => {
              if (err2) {
                tryNextFolder(index + 1);
              } else {
                processBox(box2, altList[index]);
              }
            });
          }
        } else {
          processBox(box, folderName);
        }
        
        function processBox(box, actualFolder) {
          console.log(`📬 Читаем папку ${actualFolder}, писем: ${box.messages.total}`);
          
          // Получаем последние 30 писем из папки
          imap.search(['ALL'], (err, results) => {
            if (err) {
              imap.end();
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
                  let room = 'general';
                  let isOwn = false;
                  
                  // Проверяем заголовки
                  if (parsed.headers) {
                    if (parsed.headers['x-chat-user']) {
                      from = parsed.headers['x-chat-user'];
                    }
                    if (parsed.headers['x-chat-room']) {
                      room = parsed.headers['x-chat-room'];
                    }
                  }
                  
                  // Если письмо в папке "Отправленные" или "Письма себе", значит оно наше
                  if (actualFolder === 'Отправленные' || actualFolder === 'Письма себе' || 
                      actualFolder === 'Sent' || actualFolder === 'Drafts') {
                    isOwn = true;
                    
                    // Для отправленных писем имя может быть в теме
                    if (parsed.subject) {
                      const match = parsed.subject.match(/\[(.*?)\]\s*(.*)/);
                      if (match) {
                        room = match[1];
                        from = match[2];
                      } else {
                        from = parsed.subject;
                      }
                    }
                  } else {
                    // Для входящих берем из From
                    if (parsed.from && parsed.from.text) {
                      from = parsed.from.text.split('<')[0].trim() || 'Неизвестный';
                      // Проверяем, не отправили ли мы это письмо сами
                      isOwn = parsed.from.text.includes(MAIL_CONFIG.user);
                    }
                  }
                  
                  messages.push({
                    id: parsed.messageId || Date.now() + Math.random(),
                    user: from,
                    text: parsed.text || parsed.subject || '...',
                    html: parsed.html || '',
                    time: parsed.date || new Date().toISOString(),
                    folder: actualFolder,
                    isOwn: isOwn,
                    room: room,
                    hasAttachments: parsed.attachments && parsed.attachments.length > 0
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
              console.log(`Ошибка чтения ${folderName}:`, err);
              resolve([]);
            });
          });
        }
      });
    });
    
    imap.once('error', (err) => {
      console.log(`Ошибка подключения к ${folderName}:`, err);
      resolve([]);
    });
    
    imap.connect();
  });
}
