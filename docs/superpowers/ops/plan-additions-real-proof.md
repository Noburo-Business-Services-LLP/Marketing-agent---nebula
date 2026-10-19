# One real planner run with the new blocks (about USD 0.19)

The planner additions (products and business details in; offline activity, numbers to watch and the mix out) are tested with a pretend model. This card runs the **one real run** that shows what the real model writes with them.

## What it costs
About **USD 0.19** (about Rs 16), at most about **USD 0.37** if the planner needs its one second try. At most 2 model calls; a third is blocked, and no other provider is tried. It uses your OpenAI key only for this one command, from a hidden prompt (nothing you type is shown). It does not touch the database, any wallet or any file with keys, fetches no website, and charges nobody.

## What it does
With made-up sample data (a Madurai sweet shop with four products, one of them a service, content in Tamil mixed with English), it builds the input exactly as a plan run does, then runs the real planner, its checks and the extras scan with the real writing model.

## The command
Copy all of this into Terminal and press Enter. Terminal asks for your OpenAI key; what you type is hidden.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && read -rs "KEY?OpenAI key (hidden): " && echo && OPENAI_API_KEY="$KEY" I_APPROVED_ONE_PLAN_RUN=yes node scripts/plan-additions-real-proof.js; unset KEY
```

`I_APPROVED_ONE_PLAN_RUN=yes` is your approval for this paid call; without it the script refuses and spends nothing.

## What you will see
- The model, the estimate and the answer budget.
- Calls made, whether the checks passed, and whether the answer was cut and repaired.
- Measured tokens and cost against the estimate (and a note if the estimate should be raised).
- Which of the four products the plan names.
- The offline rows with their reasons, the numbers to watch with where each is seen, and the mix.
- What the checks removed, if anything.
- A result file in your temporary folder (path printed): the sample plan, counts and cost, never the key.

## What good looks like
- One call, checks passed, not cut.
- The plan names at least two of the products, and the offline rows fit a sweet shop customers visit (for example referrals, at-counter prompts, office partnerships). No row says Nebulaa does anything offline.
- Three to five numbers to watch, each with a plain reason; nothing promises a result.
- Every sentence is in English, with no prices other than the ones in the sample and no vendor names.
- Measured cost near USD 0.19.

Send the printed output (or the result file) back. If the measured tokens are higher than the estimate, `TOKENS.blueprint_plan` in `config/apiCosts.js` is raised to the measured figure (the paid Blueprint price follows).
