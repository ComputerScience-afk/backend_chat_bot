# WhatsApp GPT Bot

Un bot de WhatsApp integrado con GPT-4 utilizando whatsapp-web.js para una conexión más robusta y natural.

## 🚀 Características

- **Integración con GPT-4**: Respuestas inteligentes y contextuales
- **whatsapp-web.js**: Conexión directa a WhatsApp Web sin necesidad de API de Meta
- **Rate Limiting**: Control automático de límites de envío
- **Comandos personalizados**: Sistema de comandos integrado
- **Manejo robusto de errores**: Recuperación automática de fallos
- **Soporte multimedia**: Capacidad de enviar imágenes y documentos
- **Logs detallados**: Sistema completo de logging

## 📋 Requisitos

- Node.js 18+ 
- Una cuenta de OpenAI con acceso a GPT-4
- WhatsApp instalado en tu teléfono
- Navegador compatible (Chrome recomendado)

## 🛠️ Instalación

1. **Clonar el repositorio**
```bash
git clone <tu-repositorio>
cd connection_chat_bot_actual_to_whatsapp
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
cp env.example .env
```

Edita el archivo `.env` con tus configuraciones:
```env
OPENAI_API_KEY=tu_api_key_de_openai_aqui
PORT=3000
```

4. **Crear directorio de logs**
```bash
mkdir logs
```

## 🏃‍♂️ Uso

1. **Iniciar el bot**
```bash
npm start
```

2. **Escanear código QR**
   - El bot mostrará un código QR en la consola
   - Abre WhatsApp en tu teléfono
   - Ve a **Configuración > Dispositivos vinculados**
   - Escanea el código QR mostrado en la consola

3. **¡Listo!** El bot estará activo y responderá a mensajes

## 📱 Comandos disponibles

- `/help` o `/ayuda` - Mostrar ayuda
- `/ping` - Verificar que el bot funciona
- `/info` - Información del bot

## 🔧 API Endpoints

El bot incluye varios endpoints para monitoreo:

- `GET /health` - Estado del bot y servicios
- `GET /info` - Información del bot
- `GET /stats` - Estadísticas de uso
- `POST /send-message` - Enviar mensaje programáticamente

### Ejemplo de envío de mensaje por API:
```bash
curl -X POST http://localhost:3000/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "to": "573001234567",
    "message": "Hola desde la API!"
  }'
```

## ⚙️ Configuración avanzada

### Rate Limiting
El bot incluye rate limiting automático:
- 6 segundos entre mensajes al mismo usuario
- Cola de mensajes cuando el cliente no está listo
- Manejo automático de límites de WhatsApp

### Personalización del prompt de IA
Puedes modificar el prompt del sistema en:
```javascript
// src/infrastructure/openai/openaiService.js
this.systemPrompt = "Tu prompt personalizado aqui...";
```

### Configuración de Puppeteer
Si tienes problemas con Chrome/Chromium, puedes ajustar los argumentos en:
```javascript
// src/infrastructure/whatsapp/whatsappService.js
puppeteer: {
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // Agregar más argumentos según necesites
    ]
}
```

## 🚨 Limitaciones importantes

- **10 mensajes por minuto por chat**: WhatsApp limita 1 mensaje cada 6 segundos por usuario
- **250 conversaciones por día**: Límite inicial que puede aumentar con buen comportamiento
- **No es API oficial**: whatsapp-web.js no es una solución oficial de WhatsApp
- **Riesgo de bloqueo**: Aunque es más seguro que otras soluciones, existe riesgo de bloqueo

## 🔍 Monitoreo y logs

Los logs se guardan en:
- `logs/error.log` - Solo errores
- `logs/combined.log` - Todos los logs
- Consola - Output en tiempo real

## 🆘 Solución de problemas

### El código QR no aparece
```bash
# Asegúrate de tener los permisos correctos
sudo chown -R $USER:$USER ./whatsapp-session
```

### Error de autenticación
```bash
# Eliminar sesión y volver a escanear
rm -rf ./whatsapp-session
npm start
```

### Problemas con Puppeteer
```bash
# Instalar dependencias de Chrome en Ubuntu/Debian
sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2
```

## 📊 Estructura del proyecto

```
src/
├── application/
│   └── messageHandler.js      # Manejo de mensajes y comandos
├── infrastructure/
│   ├── whatsapp/
│   │   └── whatsappService.js # Servicio de WhatsApp Web
│   └── openai/
│       └── openaiService.js   # Integración con OpenAI
└── utils/
    └── logger.js              # Sistema de logging
```

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## ⚠️ Disclaimer

Este bot no está afiliado con WhatsApp o Meta. El uso de bots puede violar los términos de servicio de WhatsApp. Úsalo bajo tu propia responsabilidad.

## 🆕 Changelog

### v1.0.0
- Migración de Meta API a whatsapp-web.js
- Implementación de rate limiting automático
- Sistema de comandos mejorado
- Manejo robusto de errores
- API endpoints para monitoreo
