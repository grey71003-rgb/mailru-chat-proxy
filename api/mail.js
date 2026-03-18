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
    
    // ========== ОТПРАВКА (ВСЕГДА ВО ВХОДЯЩИЕ) ==========
    else if (action === 'send') {
      const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
      
      // Формируем письмо
      const mailOptions = {
        from: MAIL_CONFIG.user,
        to: MAIL_CONFIG.user, // Отправляем себе
        subject: `📱 ${user}`,
        text: text || '',
        html: image ? `${text}<br><img src="${image}" style="max-width:300px">` : text,
        // ВАЖНО: эти заголовки гарантируют, что письмо попадёт во Входящие
        headers: {
          'X-Chat-Message': 'true',
          'X-Chat-User': user,
          'X-Priority': '1'
        }
      };
      
      // Если есть изображение
      if (image && image.startsWith('data:image')) {
        const base64Data = image.split(',')[1];
        mailOptions.attachments = [{
          filename: 'photo.jpg',
          content: base64Data,
          encoding: 'base64'
        }];
      }
      
      // Отправляем
      await transporter.sendMail(mailOptions);
      
      return res.status(200).json({ ok: true, message: 'Отправлено во Входящие' });
    }
    
    // ========== ПОЛУЧЕНИЕ (ТОЛЬКО ВХОДЯЩИЕ) ==========
    else if (action === 'get') {
      const messages = await getMessagesFromInbox();
      return res.status(200).json({ 
        ok: true, 
        messages: messages,
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

// Функция для получения писем только из Входящих
function getMessagesFromInbox() {
  return new Promise((resolve, reject) => {
    const imap = new Imap(MAIL_CONFIG.imap);
    const messages = [];
    
    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          reject(err);
          return;
        }
        
        console.log(`📬 Читаем Входящие, писем: ${box.messages.total}`);
        
        // Получаем последние 50 писем
        imap.search(['ALL'], (err, results) => {
          if (err) {
            reject(err);
            return;
          }
          
          const lastMessages = results.slice(-50);
          
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
                  time: parsed.date || new Date().toISOString()
                });
                
                processed++;
                if (processed === lastMessages.length) {
                  imap.end();
                  // Сортируем по времени (старые сверху, новые снизу)
                  messages.sort((a, b) => new Date(a.time) - new Date(b.time));
                  resolve(messages);
                }
              });
            });
          });
          
          fetch.once('error', (err) => {
            reject(err);
          });
        });
      });
    });
    
    imap.once('error', (err) => {
      reject(err);
    });
    
    imap.connect();
  });
}
