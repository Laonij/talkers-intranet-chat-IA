# Talkers Intranet Chat

## O que o projeto faz hoje
- Chat interno com login por usuario.
- Conversas persistentes com memoria local por conversa.
- Upload de arquivos e leitura de texto de PDF, DOCX, XLSX, PPTX, TXT, CSV e Markdown.
- OCR em imagens enviadas e em imagens embutidas em PPTX/DOCX.
- OCR de PDF escaneado quando o servidor tiver `pdftoppm`, `mutool` ou `magick` disponivel.
- Geracao de XLSX, PDF, DOCX, codigo e imagem.
- Base interna da empresa com busca local e, se configurado, busca vetorial via OpenAI File Search.

## Variaveis importantes
- `JWT_SECRET`: obrigatoria em producao.
- `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`: usadas para criar o admin inicial.
- `OPENAI_API_KEY`: habilita respostas da OpenAI, geracao de imagem e upload para Vector Store.
- `OPENAI_MODEL`: modelo principal de resposta. O padrao recomendado aqui e `gpt-4o-mini` por lidar melhor com arquivos.
- `OPENAI_ARTIFACT_MODEL`: modelo usado para gerar conteudo textual dos artefatos.
- `OPENAI_IMAGE_MODEL`: modelo usado na geracao de imagem.
- `OPENAI_VECTOR_STORE_ID`: Vector Store usada no `file_search`.
- `OPENAI_PROMPT_ID`: ativa a skill/prompt reutilizavel da OpenAI no fluxo do chat via Responses API.
- `OPENAI_PROMPT_VERSION`: opcional, fixa a versao do prompt reutilizavel.
- `OPENAI_PROMPT_VARIABLES_JSON`: opcional, permite injetar variaveis extras no prompt reutilizavel em formato JSON.
- `DATA_DIR`: banco SQLite, uploads e cache local. No Render, use `/var/data`.
- `INDEX_FOLDER`: pasta indexada para a base documental local. No Render, use `/var/data/kb`.
- `DRIVE_FOLDER_ID` e `DRIVE_SERVICE_ACCOUNT_JSON`: opcionais para sincronizar documentos do Google Drive.
- `DATABASE_URL`: hoje e apenas ignorada por esta versao; o projeto ainda nao usa Postgres.

## Fluxo recomendado de setup
1. Configure as envs do `.env.example` ou do `render.yaml`.
2. No Render, confirme `DATA_DIR=/var/data` e `INDEX_FOLDER=/var/data/kb`.
3. Inicie o servidor.
4. Acesse `/login.html` com o admin configurado nas envs.
5. Na tela admin, envie documentos para a base da empresa.
6. Se usar Google Drive, rode `npm run sync` e depois `npm run index`.

## Observacoes
- Se `OPENAI_VECTOR_STORE_ID` estiver configurado, a IA usa `file_search` na OpenAI alem da base local.
- Se `OPENAI_PROMPT_ID` estiver configurado, o backend envia esse prompt reutilizavel junto das chamadas da Responses API. Se a OpenAI recusar o prompt, o servidor faz fallback automatico para o fluxo padrao sem derrubar o chat.
- Arquivos enviados no admin tambem alimentam o indice local da empresa.
- Quando um PDF escaneado nao tiver texto legivel localmente, o backend tenta OCR por rasterizacao e tambem envia o arquivo bruto para a OpenAI quando couber no limite configurado.
- Se `DATABASE_URL` estiver presente em producao, o servidor registra um aviso nos logs para deixar claro que o banco ativo continua sendo o SQLite persistido em disco.
