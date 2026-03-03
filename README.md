# Talkers Intranet Chat (Render v2)

## O que você precisa configurar (produção)
- OPENAI_API_KEY (no Render → Environment)
- (Opcional) DRIVE_FOLDER_ID e DRIVE_SERVICE_ACCOUNT_JSON para sync do Drive

## Deploy no Render (via Blueprint)
1) Suba este projeto no GitHub
2) No Render: New → Blueprint → selecione o repo
3) Depois do deploy, rode no Shell do Render:
   - npm run seed
   - npm run index
4) Acesse /login.html

Observações:
- O Render precisa de disco persistente para não perder banco/arquivos.
- O servidor NÃO consegue “ler o Meu Drive” só com um link.
  Para usar Drive, compartilhe uma pasta com a Service Account e use DRIVE_FOLDER_ID.
