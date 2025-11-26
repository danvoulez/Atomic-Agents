FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]
