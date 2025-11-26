Beleza, vamos escrever isso como documento de trabalho, não palestra.

⸻

Testing Strategy — AI Coding Team

from basics until battle

0. Objetivo

Garantir que o AI Coding Team:
	1.	Não quebra código (segurança).
	2.	Entrega PRs úteis (qualidade).
	3.	Se comporta como “cérebro não-confiável em ambiente rígido” (disciplina).
	4.	Aguenta:
	•	volume (fila),
	•	casos estranhos,
	•	e versões novas de modelo/tooling
sem vir abaixo.

⸻

1. Princípios
	1.	Tudo é teste de sistema, não só de modelo
Você testa o conjunto: Ambient + Source of Truth + Tools + LLM.
	2.	Primeiro mechanic, depois genius
Genius só entra em batalha depois que mechanic está sólido.
	3.	Ledger = laboratório de regressão
Cada job bem-sucedido vira exemplo canônico pra reexecutar com novas versões.
	4.	Preferir testes com casos reais, mas com risco controlado
Repos de teste, flags de “safe mode”, PRs em branch isolado.

⸻

2. Níveis de teste

Vou organizar em 5 níveis:
	•	L0 – Infra / Ambient
	•	L1 – Tools
	•	L2 – Agent Loop (job único)
	•	L3 – Cenários completos (E2E)
	•	L4 – Battle / Red Team / Chaos

2.1 L0 – Infra / Ambient

Foco: “o habitat vive?”

Checks:
	•	Worker consegue:
	•	pegar job em queued,
	•	marcar running,
	•	marcar succeeded/failed.
	•	Em caso de crash:
	•	supervisor reinicia processo,
	•	nenhum job fica preso pra sempre em running (tem timeout + fallback).
	•	Logs básicos:
	•	por job_id,
	•	por worker_id,
	•	timestamp decente.

Critério de “ok”:
	•	100% dos jobs de teste mudam de estado corretamente.
	•	Nenhum job fica zumbi.

Ferramenta mental:
Sem isso, esquece LLM.

⸻

2.2 L1 – Tools (unidades e contratos)

Foco: “as mãos e pernas não mentem”.

Testar cada tool isolada, sem LLM no meio:
	•	Read tools:
	•	read_file, search_code, get_repo_state, etc.
	•	Testes com:
	•	input válido,
	•	input malformado,
	•	arquivo inexistente,
	•	repo sem branch.
	•	Write tools:
	•	apply_patch:
	•	patch simples,
	•	patch conflitante,
	•	patch vazio,
	•	patch grande demais (deve falhar se ultrapassar limite).
	•	run_tests:
	•	sucesso,
	•	teste falhando,
	•	timeout (simulado),
	•	falta de dependência.
	•	open_pr:
	•	branch com commit,
	•	branch sem commit (deve recusar),
	•	repo sem permissão.

Invariantes a garantir:
	•	Tools sempre retornam:
	•	status claro (ok/erro),
	•	mensagem humana curta,
	•	referências (commit, branch, pr_id, log_ref).
	•	Em falha:
	•	não deixam o repo num estado semi-aplicado (idempotência / atomicidade onde der).
	•	Nenhuma tool grava fora do ledger sem registrar evento correspondente.

Critério de “ok”:
	•	Todas as tools têm testes automatizados (unit/integration simples).
	•	Nenhuma tool causa side-effect invisível.

⸻

2.3 L2 – Agent Loop (job único, controlled environment)

Agora você coloca o LLM na jogada, mas em terreno de treino.

Ideia: para um job específico e um repo de teste, você quer:

“dado esse issue + repo, o agente deve seguir esse roteiro aproximado de ferramentas e produzir esse tipo de PR.”

Tipos de casos:
	1.	Bug trivial
	•	Repo micro, bug óbvio.
	•	Esperado:
	•	poucos steps,
	•	patch pequeno,
	•	testes passam,
	•	PR limpo.
	2.	Bug não resolvível só com contexto local
	•	Falta de informação, descrição muito vaga.
	•	Esperado:
	•	agente faz search, read_file,
	•	registra analysis honesta,
	•	termina em request_human_review, NÃO inventa fix.
	3.	Bug que explode limites (patch grande)
	•	Pra ver se o agente respeita o limite de diff.
	•	Esperado:
	•	ele detecta que o patch ficou grande,
	•	aborta ou pede revisão, não abre PR gigante em mechanic.

O que você avalia aqui:
	•	Sequência de events no ledger:
	•	faz sentido?
	•	passos redundantes?
	•	Uso de tools:
	•	usa leitura antes de mutar?
	•	trata erros de tool (ex: teste falhou → não continuar como se tivesse passado)?
	•	Saída final:
	•	PR condizente com objetivo,
	•	mensagem de commit/PR razoável.

Critério de “ok”:
	•	Pra um conjunto de N casos canônicos, a maioria (>= X%) termina no outcome esperado (PR ou escalate) sem violar invariantes.

⸻

2.4 L3 – Cenários completos (E2E, múltiplos jobs, fila)

Aqui você testa:
	•	fim a fim,
	•	com fila, vários jobs,
	•	integrando com:
	•	sistema de issues,
	•	git real (ou mirror),
	•	CI/linters reais ou simulados.

Cenários:
	1.	Lote de bugs simples (mechanic-only)
	•	10 issues fáceis em sequência.
	•	Métricas:
	•	tempo médio até PR,
	•	taxa de sucesso (testes verdes),
	•	tamanho médio de diff,
	•	quantos jobs vão pra waiting_human sem precisar.
	2.	Mix de fácil/difícil
	•	5 fáceis, 5 difíceis.
	•	Esperado:
	•	fáceis → PR automático,
	•	difíceis → análise + plano + escalate.
	3.	CI instável / erro externo
	•	Simular build quebrando por motivo alheio ao bug.
	•	Esperado:
	•	agente não assume que o bug não foi consertado,
	•	registra erro do ambiente,
	•	pode marcar o job como “blocked by CI”, não como falha de lógica.

Aqui você está testando:
	•	AMBIENT:
	•	workers não se pisam,
	•	fila anda,
	•	nada entra em deadlock.
	•	SURVEILLANCE:
	•	logs e métricas fazem sentido,
	•	você consegue investigar qualquer job.

Critério de “ok”:
	•	Sistema aguenta N jobs em paralelo sem:
	•	enfileirar pra sempre,
	•	travar workers,
	•	gerar PRs nonsense.

⸻

2.5 L4 – Battle / Red Team / Chaos

Agora é “batalha” mesmo: tentar quebrar o sistema, não provar que ele é lindo.

Eixos:
	1.	Prompt / input adversarial
	•	Issues ambíguas,
	•	pedindo pra violar regra (“dá bypass no limite de desconto”, equivalente em código),
	•	descrições contraditórias.
	2.	Codebase hostil
	•	Código bagunçado,
	•	nome de variável confuso,
	•	múltiplos lugares parecidos onde o bug poderia estar.
	3.	Limites de recurso
	•	Caps de tokens muito baixos,
	•	timeout agressivo,
	•	minimiza steps.

O que você mede:
	•	Quantas vezes o agente:
	•	inventa coisa que não tem no código?
	•	ignora erro de tool e segue como se tivesse tudo certo?
	•	quebra invariantes do seu design (toca main, patch grande, etc.)?

Aqui vale até rodar versões diferentes de modelo com o mesmo conjunto de jobs registrados, usando o ledger como replay: ver qual modelo respeita mais as regras.

Objetivo de battle:
	•	Encontrar pontos cegos de design:
	•	tool que dá liberdade demais,
	•	falta de checagem no ambient,
	•	prompt muito permissivo em genius.

Resultado disso são patches na arquitetura, não só no prompt.

⸻

3. Métricas de sanidade que valem ouro

Independente do nível, monitora:
	•	Taxa de jobs “sem saída”:
	•	jobs que nunca saem de running/queued.
	•	Taxa de PR revertido por humano:
	•	sinal forte de problema de qualidade/scope.
	•	% de jobs que terminam em “não sei / escalate”:
	•	muito baixo → talvez agente esteja arriscando demais;
	•	muito alto → falta ferramenta/contexto.
	•	Média de steps por job:
	•	pode indicar desperdício (ficou rodando search/mudando de ideia).

Essas métricas te dizem se o sistema está “puxando pra honestidade” ou pra maquiagem.

⸻

4. Como isso vira rotina, não projeto único

Idealmente:
	•	L0/L1/L2: rodam sempre (CI clássico).
	•	L3: rola como smoke test diário ou sob demanda (antes de trocar modelo/tool major).
	•	L4 (battle):
	•	rodadas periódicas (ex: 1x por mês),
	•	ou sempre que fizer mudança grande (modelo novo, tool nova, mudança de policy).

E o mais importante:
Quando aparecer um job real que foi muito bem resolvido (ou muito mal):
	•	você extrai esse caso,
	•	transforma em test case fixo,
	•	e inclui no conjunto de regressão.

⸻

Se você quiser, no próximo passo posso te ajudar a escolher 5–10 casos reais (já que você está testando local) e etiquetar:
	•	este é L2,
	•	estes 3 são bons pra L3,
	•	estes 2 viram material de L4 / red team.