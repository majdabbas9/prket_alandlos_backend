# Use Node.js 20 lightweight Alpine image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package management files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose backend port
EXPOSE 8080

# Run backend server
CMD ["npm", "start"]
