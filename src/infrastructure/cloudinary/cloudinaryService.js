const cloudinary = require('cloudinary').v2;
const { logger } = require('../../utils/logger');

// Configuración de Cloudinary usando CLOUDINARY_URL
if (process.env.CLOUDINARY_URL) {
    // Configuración automática usando CLOUDINARY_URL
    cloudinary.config({
        cloudinary_url: process.env.CLOUDINARY_URL
    });
    logger.info('Cloudinary configured using CLOUDINARY_URL');
} else {
    // Configuración manual (fallback)
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });
    logger.info('Cloudinary configured using individual variables');
}

class CloudinaryService {
    async uploadBuffer(buffer, options = {}) {
        try {
            const uploadOptions = {
                folder: options.folder || 'whatsapp-media',
                resource_type: options.resource_type || 'auto',
                ...options
            };

            logger.info(`Uploading to Cloudinary: ${uploadOptions.folder}`);

            const uploadResponse = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    uploadOptions,
                    (error, result) => {
                        if (error) {
                            logger.error('Cloudinary upload error:', error);
                            reject(error);
                        } else {
                            logger.info(`Upload successful: ${result.secure_url}`);
                            resolve(result);
                        }
                    }
                );

                uploadStream.end(buffer);
            });

            return {
                url: uploadResponse.secure_url,
                public_id: uploadResponse.public_id
            };
        } catch (error) {
            logger.error('Error uploading to Cloudinary:', error);
            throw error;
        }
    }

    async uploadAudio(buffer, folder = 'whatsapp-audio') {
        return this.uploadBuffer(buffer, {
            folder,
            resource_type: 'video' // Los audios en Cloudinary van como 'video'
        });
    }

    async uploadImage(buffer, folder = 'whatsapp-images') {
        return this.uploadBuffer(buffer, {
            folder,
            resource_type: 'image'
        });
    }

    async uploadVideo(buffer, folder = 'whatsapp-videos') {
        return this.uploadBuffer(buffer, {
            folder,
            resource_type: 'video'
        });
    }

    async uploadDocument(buffer, fileType, folder = 'whatsapp-documents') {
        return this.uploadBuffer(buffer, {
            folder,
            resource_type: 'raw'
        });
    }
}

module.exports = new CloudinaryService(); 