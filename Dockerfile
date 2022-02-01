FROM node:16.13-slim

# Create app directory
WORKDIR /app

COPY package*.json ./

RUN npm install -g ts-node
RUN yarn install
RUN npm install
RUN npm ci --only=production

# Bundle app source
COPY . .

CMD [ "ts-node", "index.ts" ]