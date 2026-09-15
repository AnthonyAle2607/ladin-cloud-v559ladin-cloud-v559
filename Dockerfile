# Imagen base ligera de Node.js
FROM node:20-alpine

# Instalar dependencias de compilación para módulos nativos (sqlite3 / bcrypt)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copiar archivos de configuración e instalar dependencias
COPY package*.json ./
RUN npm install --production

# Copiar el código fuente de la aplicación
COPY . .

# Crear directorios para uploads y persistencia
RUN mkdir -p uploads/quejas backups

# Exponer el puerto de la aplicación
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Comando de inicio del servidor
CMD ["npm", "start"]
