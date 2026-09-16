FROM node:24-alpine

LABEL io.docker.server.metadata='{"name":"mcp-revisao-b1","description":"Revisão da avaliação B1 de Tecnologias Emergentes, com busca no conteúdo da turma e cálculo de custo de chamada","transport":"stdio","allowHosts":["raw.githubusercontent.com:443"]}'

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY servidor.ts ./
COPY dados ./dados

USER node

ENTRYPOINT ["node", "servidor.ts"]
