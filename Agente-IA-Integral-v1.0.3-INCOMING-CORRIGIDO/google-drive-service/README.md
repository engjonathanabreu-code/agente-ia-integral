# Conexão Google de Guaratuba

Alternativa para o Meu Drive quando não é possível preparar um cliente OAuth pelo Google Cloud. O serviço executa na conta Google proprietária, usando o Drive avançado v3. O token Google permanece no Apps Script. O agente usa uma chave de 256 bits para chamar operações restritas à árvore da pasta Guaratuba.

## Configuração

- Criar um projeto separado e enviar `Code.gs` e `appsscript.json`.
- Definir a propriedade de script `INTEGRAL_DRIVE_SECRET` com 64 caracteres hexadecimais aleatórios. Se o editor de configurações estiver indisponível, injetar `SETUP_SECRET_GUARATUBA` somente na cópia privada enviada ao Google, protegida fora do repositório. Não guardar o valor no Git, no plugin, em logs ou em documentos de entrega.
- Autorizar e implantar como aplicação da Web que executa na conta proprietária. O endpoint aceita chamadas públicas, mas toda leitura ou criação exige a chave; GET não revela dados. A implantação e as permissões precisam de aprovação explícita na interface Google.
- Guardar somente em produção `GOOGLE_DRIVE_SCRIPT_URL` (URL real `/macros/s/.../exec`) e `GOOGLE_DRIVE_SCRIPT_SECRET`, protegida como Secret. Publicar o agente para carregar essas variáveis.
- Testar leitura e criação de um arquivo técnico antes de ativar. A versão publicada deve conter exatamente o código revisado. Verificar identidade, pasta, hash e idempotência; o fluxo permanece desligado até essa prova.

O manifesto pede leitura do Drive e acesso aos arquivos criados/selecionados para este aplicativo. O código aplica o limite adicional de Guaratuba e não oferece edição, exclusão, alteração de permissões ou exportação de tokens. O upload preserva originais, exige formato e hash e confirma o recibo. A conexão existente por OAuth ou conta de serviço continua disponível quando esta alternativa não estiver configurada.

Clasp é usado somente para configurar este projeto. Sua credencial de desenvolvimento fica temporariamente protegida fora do repositório e não é transferida ao servidor. O cliente pede somente configuração/implantação de scripts e confirmação de e-mail; não precisa de acesso global ao Google Cloud, faturamento ou logs.
