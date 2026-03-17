// api/mail.js - Прокси для работы с почтой Mail.ru (ES Module версия)
import imaps from 'imap-simple';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

// ========== ТВОИ ДАННЫЕ ==========
const MAIL_CONFIG = {
  imap: {
    user: 'chat-helloworld@mail.ru',
    password: 'Uw5dyegGhHQaVwtagSvP',
    host: 'imap.mail.ru',        // правильный сервер
    port: 993,                    // правильный порт для IMAP
    tls: true,                     // используем SSL
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 30000
  },
  smtp: {
    host: 'smtp.mail.ru',         // правильный сервер
    port: 465,                     // правильный порт для SMTP
    secure: true,                   // используем SSL
    auth: {
      user: 'chat-helloworld@mail.ru',
      pass: 'Uw5dyegGhHQaVwtagSvP'
    },
    tlsOptions: { rejectUnauthorized: false }
  }
};

// ========== ОБРАБОТЧИК ==========
export default async function handler(req, res) {
  // Разрешаем запросы с любого домена (CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Обработка preflight запросов (для CORS)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, room = 'INBOX' } = req.query;
  const { user, text, image } = req.body || {};

  try {
    // ========== ПРОВЕРКА ПОДКЛЮЧЕНИЯ ==========
    if (action === 'test') {
      console.log('🔄 Тестируем подключение к Mail.ru...');
      console.log('📧 Подключаемся к IMAP серверу:', MAIL_CONFIG.imap.host + ':' + MAIL_CONFIG.imap.port);
      
      try {
        // Пробуем подключиться к IMAP
        const connection = await imaps.connect(MAIL_CONFIG.imap);
        console.log('✅ IMAP подключение успешно');
        await connection.openBox('INBOX');
        console.log('✅ Папка INBOX открыта');
        await connection.end();
        
        // Пробуем отправить тестовое письмо
        console.log('📧 Подключаемся к SMTP серверу:', MAIL_CONFIG.smtp.host + ':' + MAIL_CONFIG.smtp.port);
        const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
        await transporter.verify();
        console.log('✅ SMTP подключение успешно');
        
        res.status(200).json({ 
          ok: true, 
          message: 'Подключение к Mail.ru успешно установлено' 
        });
      } catch (imapError) {
        console.error('❌ Ошибка подключения:', imapError);
        res.status(500).json({ 
          ok: false, 
          error: imapError.message,
          details: 'Ошибка подключения к серверу Mail.ru. Проверь настройки.'
        });
      }
    }
    
    // ========== ПОЛУЧЕНИЕ СООБЩЕНИЙ ==========
    else if (action === 'get') {
      console.log('📥 Получаем сообщения из папки:', room);
      
      const connection = await imaps.connect(MAIL_CONFIG.imap);
      await connection.openBox(room);
      
      // Ищем все письма
      const searchCriteria = ['ALL'];
      const fetchOptions = {
        bodies: ['HEADER', 'TEXT'],
        struct: true,
        markSeen: false
      };
      
      const messages = await connection.search(searchCriteria, fetchOptions);
      const results = [];
      
      // Берем последние 50 сообщений
      const lastMessages = messages.slice(-50);
      
      for (const item of lastMessages) {
        const textPart = item.parts.find(part => part.which === 'TEXT');
        const header = item.parts.find(part => part.which === 'HEADER');
        
        if (textPart && header) {
          const parsed = await simpleParser(textPart.body);
          
          results.push({
            id: item.attributes.uid,
            user: header.body.subject[0] || 'Неизвестный',
            text: parsed.text || parsed.html || '',
            time: header.body.date[0] || new Date().toISOString(),
            hasAttachments: parsed.attachments.length > 0
          });
        }
      }
      
      await connection.end();
      
      console.log(`✅ Загружено ${results.length} сообщений`);
      
      res.status(200).json({
        ok: true,
        messages: results.reverse(),
        room: room
      });
    }
    
    // ========== ОТПРАВКА СООБЩЕНИЯ ==========
    else if (action === 'send') {
      console.log('📤 Отправляем сообщение от:', user);
      
      const transporter = nodemailer.createTransport(MAIL_CONFIG.smtp);
      
      const mailOptions = {
        from: MAIL_CONFIG.smtp.auth.user,
        to: MAIL_CONFIG.smtp.auth.user,
        subject: user,
        text: text,
        html: image ? `<p>${text}</p><img src="${image}" style="max-width: 300px;">` : text,
      };
      
      if (image && image.startsWith('data:image')) {
        const base64Data = image.split(',')[1];
        mailOptions.attachments = [{
          filename: 'photo.jpg',
          content: base64Data,
          encoding: 'base64'
        }];
      }
      
      const info = await transporter.sendMail(mailOptions);
      console.log('✅ Сообщение отправлено, ID:', info.messageId);
      
      res.status(200).json({ 
        ok: true, 
        id: info.messageId,
        time: new Date().toISOString()
      });
    }
    
    else {
      res.status(400).json({ 
        ok: false, 
        error: 'Укажите action: test, get или send' 
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка Mail.ru API:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      details: 'Проверь логин и пароль приложения'
    });
  }
}
