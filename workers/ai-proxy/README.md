# Maham One AI proxy

A small Cloudflare Worker that sits between the Maham One app and Google's Gemini API. It holds the Gemini key so the app never has to: anything inside the app can be read by anyone who opens it, so the key must live somewhere only Cloudflare can see.

```
Maham One app (in the browser, signed in)
   |  POST /v1/generate  or  /v1/stream
   |  Authorization: Bearer <the person's Supabase sign-in token>
   v
This Worker (Cloudflare)
   - checks the sign-in with Supabase
   - checks the request (size, model, fields) and the per-person limit
   |  x-goog-api-key: <GEMINI_API_KEY, an encrypted Cloudflare secret>
   v
Google Gemini API
```

This is **phase 1**: the Worker only. The app does not use it yet. In phase 2 the app gets the Worker's address as `VITE_AI_PROXY_URL` and an owner switch to turn AI on for the company.

Two things to know before you start:

- **Only signed-in people can use it.** The Worker refuses any request without a valid Maham One cloud sign-in. A company kept on this device only (not signed in to the cloud) can't use AI.
- **Do not send real company data until billing is on** (step 1.2). On Google's free tier, Google may use what is sent to improve its products and people at Google may read it. That is not acceptable for payroll, Civil IDs, salaries or IBANs.

What's in this folder:

| File                | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `src/worker.js`     | The Worker. One file, no dependencies, so it can be pasted into the dashboard. |
| `wrangler.toml`     | Its settings for the command-line way (B). Safe to keep in git: no secrets.    |
| `.dev.vars.example` | The shape of the local secrets file for testing on a computer.                 |
| `test/`             | Automated tests (run with the app's tests).                                    |

---

## Step 1. Get a Gemini API key, on the paid tier

### 1.1 Create the key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and sign in with the company's Google account.
2. Choose **Create API key**. When asked for a Google Cloud project, create a new one just for this, for example `maham-one-ai`, so its billing, limits and key are separate from anything else.
3. Copy the key (it starts with `AIza`). Keep it only in a password manager until step 2. Never paste it into the app, a chat, an email, a ticket or GitHub, and never send it to us.

### 1.2 Turn on billing (required before real data)

Google's terms for the Gemini API differ by tier:

- **Free tier:** Google may use prompts and answers to improve its products, and human reviewers may read them.
- **Paid tier** (Cloud Billing turned on for the key's project): prompts and answers are not used to improve Google's products.

To turn it on:

1. In AI Studio, on the API keys page, find the key's project and choose **Set up billing** (or go to [Google Cloud console](https://console.cloud.google.com/) → **Billing** → **Link a billing account** and pick the project).
2. Add or choose a billing account and finish the steps.
3. Back on the AI Studio API keys page, check that the project now shows a paid plan or tier (for example "Tier 1") instead of "Free".

Until it does, test only with made-up text such as "Write a short thank-you note to a customer".

Google's terms change from time to time; read the current [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms) yourself, including how long Google may keep requests to detect abuse.

### 1.3 Restrict the key to the Gemini API

1. In [Google Cloud console](https://console.cloud.google.com/), pick the key's project at the top.
2. **APIs & Services** → **Credentials** → click the key.
3. Under **API restrictions** choose **Restrict key** and tick only **Generative Language API**. Save.
4. Leave **Application restrictions** at **None**: the Worker's network addresses change, and the key is protected by living only in Cloudflare.

### 1.4 Set a budget alert and a hard limit

A budget only warns you; a quota actually stops spending. Set both.

1. **Budget:** Google Cloud console → **Billing** → **Budgets & alerts** → **Create budget**. Scope it to the key's project, set a monthly amount (for example USD 20), and keep the alerts at 50%, 90% and 100%. The billing account's admins get the emails.
2. **Quota:** Google Cloud console → **APIs & Services** → **Generative Language API** → **Quotas & system limits**. Find the requests-per-day (and per-minute) limits for the model and choose **Edit** to lower them to what the company needs, for example 2,000 a day. The names on that page change; look for "generate content requests".

---

## Step 2. Deploy the Worker

Pick **one** way. Both give you an address like `https://maham-ai-proxy.<your-subdomain>.workers.dev`.

### Way A: the Cloudflare dashboard only

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com/) and open **Workers & Pages** (under **Compute**).
2. Choose **Create** → **Create Worker** (or **Start with Hello World!**). Name it `maham-ai-proxy` and choose **Deploy**.
3. Choose **Edit code**. Delete everything in `worker.js`, paste the whole of [`src/worker.js`](src/worker.js) from this folder, and choose **Deploy**.
4. Go to the Worker's **Settings** → **Variables and Secrets**. Choose **Add** for each of these, with type **Text**:

   | Variable name              | Value                                            |
   | -------------------------- | ------------------------------------------------ |
   | `GEMINI_MODEL`             | `gemini-3.6-flash`                               |
   | `ALLOWED_MODELS`           | `gemini-3.6-flash`                               |
   | `ALLOWED_ORIGINS`          | `https://mahamone.com`                           |
   | `SUPABASE_URL`             | `https://gagdyhintrxdkiqhahzh.supabase.co`       |
   | `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_KyVAkWtemw_XDnNK8ZKRpA_-5x4pk8d` |
   | `MAX_OUTPUT_TOKENS`        | `8192`                                           |
   | `MAX_BODY_BYTES`           | `262144`                                         |

   The publishable key is public by design (the app already contains it); it only names the Supabase project.

5. Same page: **Add** → type **Secret** (not Text) → name `GEMINI_API_KEY` → paste the key from step 1.1 → **Deploy**. Once saved, a secret is encrypted and can't be read back by anyone, only replaced.
6. **Settings** → **Bindings** → **Add binding**. If **Rate limiting** is offered, add it with variable name `AI_RATE_LIMITER`, limit `30`, period `60` seconds (namespace ID `1001` if asked). If the dashboard doesn't offer it, carry on: the Worker then has no per-person limit of its own, Google's quota from step 1.4 still applies, and way B can add it later.
7. **Settings** → **Runtime**: set the compatibility date to `2026-10-01` or later, and add the compatibility flag `enable_request_signal` if you can. It lets the Worker stop Google's work as soon as the app closes the connection. Optional.
8. **Settings** → **Observability**: turn **Workers Logs** on. If there's a separate switch for invocation logs, turn that off: the Worker writes its own log line for every request.
9. **Settings** → **Domains & Routes**: check that the `workers.dev` address is on and copy it.
10. Test it (step 3).

If you change the code later, repeat step 3 with the new `src/worker.js`. If you switch to way B later, note that `wrangler deploy` makes the Worker match `wrangler.toml`: variables added only in the dashboard are replaced by the file's (the secret is kept).

### Way B: the command line (Wrangler)

You need [Node.js 22](https://nodejs.org/) (the same version as the app). In a terminal, from the top of this repository:

```sh
cd workers/ai-proxy
npm install                          # installs Wrangler for this folder only
npx wrangler login                   # opens a browser to sign in to Cloudflare
npx wrangler secret put GEMINI_API_KEY
```

The last command asks for the value: paste the key from step 1.1 and press Enter (nothing shows while you paste). The first time, it also asks whether to create a Worker called `maham-ai-proxy`: answer **y**. Then:

```sh
npx wrangler deploy                  # prints the workers.dev address
npx wrangler tail                    # live log lines; Ctrl+C to stop
```

If the Cloudflare account has no `workers.dev` subdomain yet, `wrangler deploy` asks you to pick one. Wrangler may also warn that several environments are defined; that's harmless, these commands use the main one (`npm run deploy` and `npm run tail` name it explicitly). Everything else (variables, the rate limit, logs) comes from `wrangler.toml`.

To check the settings without a Cloudflare account, `npm run check` bundles the Worker without uploading it (it writes a `dist-check` folder you can delete).

### Optional: ai.mahamone.com instead of workers.dev

This only works if `mahamone.com`'s DNS is managed by Cloudflare (the domain is a zone in the same Cloudflare account). The app is hosted on Vercel, so check where the DNS lives first. If it is on Cloudflare: in the dashboard, **Settings** → **Domains & Routes** → **Add** → **Custom domain** → `ai.mahamone.com`; or turn on the commented `routes` line in `wrangler.toml` and deploy again. Nothing else changes: the allowed origin stays `https://mahamone.com`.

### Optional: a second Worker for testing on a computer

`wrangler.toml` also defines `maham-ai-proxy-dev`, which accepts requests from the app running at `http://localhost:5173`. Deploy it with `npx wrangler deploy --env dev` and give it its own key with `npx wrangler secret put GEMINI_API_KEY --env dev`. Use a separate key, and made-up data only.

---

## Step 3. Test it

In the commands below, replace the address with yours. On Windows, use **PowerShell** and type `curl.exe` instead of `curl`, and put the whole command on one line (drop the `\` at the line ends).

```sh
WORKER=https://maham-ai-proxy.your-subdomain.workers.dev
```

**3.1 Health check** (no sign-in needed):

```sh
curl -i $WORKER/health
```

Expect `200` and `{"ok":true,"model":"gemini-3.6-flash"}`.

**3.2 Without a sign-in** (must be refused):

```sh
curl -i -X POST $WORKER/v1/generate \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Say hello in Arabic and English."}]}]}'
```

Expect `401` and `"code":"unauthorized"`.

**3.3 With your sign-in.** Copy your access token from the signed-in app:

1. Open [mahamone.com](https://mahamone.com) in Chrome or Edge and sign in.
2. Open the developer tools (**F12**, or **Cmd+Option+I** on a Mac) → **Application** tab → **Local Storage** → `https://mahamone.com` → the key `almailbooks.auth`. (In Firefox and Safari it's the **Storage** tab.)
3. Its value is a block of text. Copy only the value of `access_token`: the long text starting with `eyJ`, without the quotes. Do not copy the `refresh_token`.

   Or, in the developer tools' **Console** tab, type this and press Enter; it copies the token for you:

   ```js
   copy(JSON.parse(localStorage.getItem('almailbooks.auth')).access_token);
   ```

This token lets whoever has it act as you in Maham One until it expires (about an hour). Use it only in your own terminal, and never send it to anyone, including us.

```sh
TOKEN=paste-the-access-token-here

curl -i -X POST $WORKER/v1/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Say hello in Arabic and English."}]}]}'
```

Expect `200` and Gemini's answer as JSON (the text is under `candidates[0].content.parts[0].text`). The same with streaming, where the answer arrives in pieces as `data:` lines:

```sh
curl -N -X POST $WORKER/v1/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Write three short tips for keeping invoices tidy."}]}]}'
```

**3.4 CORS** (which web pages may call it from a browser):

```sh
# The app's own address: expect 204 and "Access-Control-Allow-Origin: https://mahamone.com"
curl -i -X OPTIONS $WORKER/v1/generate \
  -H "Origin: https://mahamone.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type"

# Any other website: expect 403 and no Access-Control-Allow-Origin header
curl -i $WORKER/health -H "Origin: https://example.com"
```

CORS only controls what web pages can do inside a browser. It is not a lock: tools like curl can send any `Origin`, or none. The sign-in check in 3.2 and 3.3 is what keeps others out.

**3.5 Watch the logs** with `npx wrangler tail` (way B) or the Worker's **Logs** tab in the dashboard. Each request writes one line like:

```json
{
  "route": "generate",
  "method": "POST",
  "user": "3f9c1a2b7d4e5f60",
  "auth": "checked",
  "model": "gemini-3.6-flash",
  "usage": { "prompt": 9, "output": 24, "total": 61 },
  "status": 200,
  "ms": 1840
}
```

`user` is a scrambled stand-in for the person, not their id or email. Prompts, answers, tokens and the key are never logged.

---

## Step 4. What to send back to us

Only the Worker's address, for example `https://maham-ai-proxy.your-subdomain.workers.dev` (or `https://ai.mahamone.com`). It would also help to say which way you used (A or B), whether the rate limiting binding was added, and that billing is on.

**Never** send the Gemini key or your access token. We don't need either: the key stays in Cloudflare, and the app gets each person's token when they sign in.

---

## Rotating the key

Do this if the key may have been seen by someone, when someone with access to it leaves, and otherwise about once a year.

1. In [AI Studio](https://aistudio.google.com/apikey), create a new key **in the same project** (so billing and the paid-tier terms carry over), and restrict it as in step 1.3.
2. Put it in the Worker: dashboard → the Worker → **Settings** → **Variables and Secrets** → `GEMINI_API_KEY` → edit → paste → **Deploy**. Or run `npx wrangler secret put GEMINI_API_KEY` again.
3. Test with step 3.3.
4. Delete the old key: Google Cloud console → **APIs & Services** → **Credentials** → the old key → **Delete**.

If the key has leaked, delete it first (step 4), then do steps 1 to 3. AI is unavailable in between.

## Changing the model

Google renames and retires models often. When it retires the one in `GEMINI_MODEL`, the Worker answers `upstream_error` ("The AI model is not available"). To change it, set both `GEMINI_MODEL` and `ALLOWED_MODELS` to the new name from [Google's model list](https://ai.google.dev/gemini-api/docs/models): in the dashboard (**Variables and Secrets**) or in `wrangler.toml` followed by `npx wrangler deploy`. `ALLOWED_MODELS` may list several, separated by commas; the app can then pick one of them, and nothing else.

---

## Settings

| Name                       | Where                 | What it does                                                                                                    |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`           | Secret                | The Gemini key. Only ever set as an encrypted secret.                                                           |
| `GEMINI_MODEL`             | Variable              | The model used when the app names none, and shown by `/health`.                                                 |
| `ALLOWED_MODELS`           | Variable              | The models the app may ask for, comma-separated. Others get `model_not_allowed`.                                |
| `ALLOWED_ORIGINS`          | Variable              | The web addresses allowed by CORS, comma-separated and exact. `*` is not accepted.                              |
| `SUPABASE_URL`             | Variable              | The Supabase project people sign in with.                                                                       |
| `SUPABASE_PUBLISHABLE_KEY` | Variable              | Its publishable key (public).                                                                                   |
| `MAX_OUTPUT_TOKENS`        | Variable              | The longest answer, in tokens (Gemini counts its "thinking" in this too). Default 8192.                         |
| `MAX_BODY_BYTES`           | Variable              | The largest request, in bytes. Default 262144 (256 KB). Raise it if the app needs to send pictures of receipts. |
| `UPSTREAM_TIMEOUT_MS`      | Variable (optional)   | How long to wait for Google to start answering. Default 30000 (30 seconds).                                     |
| `STREAM_IDLE_TIMEOUT_MS`   | Variable (optional)   | The longest pause allowed in the middle of a streamed answer. Default 60000.                                    |
| `AI_RATE_LIMITER`          | Rate limiting binding | 30 requests a minute per person. Without it, there's no per-person limit in the Worker.                         |

---

## Error codes

Every error is JSON like `{"error":{"code":"unauthorized","message":"Sign in to use the AI assistant.","status":401}}`. The `message` is safe to show to the person; `status` repeats the HTTP status.

| Code                | HTTP         | What it means                                                                                                                                | What to do                                                                                                                          |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`      | 401          | No sign-in token, or Supabase says it is expired or not valid.                                                                               | Sign in again (the app refreshes tokens on its own). If everyone gets it, check `SUPABASE_URL`.                                     |
| `forbidden_origin`  | 403          | The request came from a web page not in `ALLOWED_ORIGINS`.                                                                                   | Add the app's exact address (for example `https://mahamone.com`) to `ALLOWED_ORIGINS`.                                              |
| `bad_request`       | 400          | The request isn't valid JSON or misses `contents`, or Google couldn't use it (its short reason is included).                                 | A problem in the app's request; tell us the message.                                                                                |
| `payload_too_large` | 413          | The request is bigger than `MAX_BODY_BYTES`.                                                                                                 | Send less, or raise `MAX_BODY_BYTES`.                                                                                               |
| `model_not_allowed` | 400          | The app asked for a model that isn't in `ALLOWED_MODELS`.                                                                                    | Add it to `ALLOWED_MODELS` if it should be allowed.                                                                                 |
| `rate_limited`      | 429          | Too many requests from this person (30 a minute), or Google's quota for the key is used up.                                                  | Wait for the seconds in the `Retry-After` header. If it keeps happening, raise the Google quota (step 1.4).                         |
| `upstream_error`    | 502 (or 503) | Google failed or refused: Google is down or overloaded, the key is wrong or restricted, billing, the model was retired, or Supabase is down. | Try again. If it persists, check the log line (`upstream`, `googleStatus`, `reason`), the key (step 1), billing and `GEMINI_MODEL`. |
| `upstream_timeout`  | 504          | Google (or Supabase) took too long to answer.                                                                                                | Try again; ask for a shorter answer.                                                                                                |
| `not_found`         | 404          | No such address or method. The routes are `GET /health`, `POST /v1/generate`, `POST /v1/stream`.                                             | Check the address.                                                                                                                  |
| `internal`          | 500          | The Worker isn't set up: the `GEMINI_API_KEY` secret is missing, or a variable is wrong. The log line names it (`problem`).                  | Add the secret or fix the variable.                                                                                                 |

During a streamed answer, the HTTP status is already 200 when the answer starts. If Google fails after that, the stream ends with an event named `error` whose data is the same JSON:

```
event: error
data: {"error":{"code":"upstream_error","message":"The AI service stopped in the middle of the answer.","status":502}}
```

---

## Who can use it, and the limits

- **Anyone signed in to the Maham One cloud** can use it, up to 30 requests a minute each. That includes someone who signs up on their own, since the app allows sign-ups. Phase 2 can narrow this to members of the company and put it behind the owner's switch. Google's quota (step 1.4) is the overall ceiling.
- **Not signed in, not served:** a company kept on this device only can't use AI.
- The per-person limit is counted in each Cloudflare location separately, so it is a guard against runaway loops rather than an exact count.
- Requests are at most 256 KB (`MAX_BODY_BYTES`) and answers at most 8192 tokens (`MAX_OUTPUT_TOKENS`). One answer per request.
- Only the fields the app needs are passed on: `contents`, `systemInstruction`, `generationConfig`, `safetySettings`, `tools` and `toolConfig`. Everything else is dropped.
- `tools` may only describe the app's own functions (function calling). Google Search, URL fetching and code execution are refused, since they would send data elsewhere or bill separately. File links (`fileData`) are refused too; files must be sent inline.
- What Google receives: only those fields. Not the person's token, user id, email or address; Google sees Cloudflare's network address. Cloudflare passes the data through and its logs hold only the metadata line shown in step 3.5.
- Cloudflare's Workers Free plan allows 100,000 requests a day; check Cloudflare's current plan limits if the company grows.

---

## For developers

**Request** (both `/v1/generate` and `/v1/stream`): JSON with `contents` (required), and optionally `model` (from `ALLOWED_MODELS`), `systemInstruction`, `generationConfig`, `safetySettings`, `tools` (`[{ "functionDeclarations": [...] }]`) and `toolConfig`, as in the [Gemini API](https://ai.google.dev/api/generate-content). Headers: `Authorization: Bearer <Supabase access token>` and `Content-Type: application/json`.

**Answer:** `/v1/generate` returns Gemini's `generateContent` response as it is. `/v1/stream` passes Gemini's `streamGenerateContent?alt=sse` events through unchanged, as they arrive, then possibly one `event: error` as above; a client should ignore a `data:` line it can't parse just before an `error` event. Errors before the first byte are ordinary JSON errors. `Retry-After` is readable from the browser.

**Run it on this computer:** `cp .dev.vars.example .dev.vars`, put a test key in `.dev.vars` (git-ignored), then `npm run dev` (the `dev` settings, which allow `http://localhost:5173`); it listens on `http://localhost:8787`.

**Tests:** from the top of the repository, `npm test` runs them with the app's tests (`npm test -- workers/ai-proxy` for these only); `npm test` in this folder does the same (it needs the app's own `npm ci` at the top first). They replace Supabase and Google with fakes; nothing goes over the network.

**Phase 2** will add `VITE_AI_PROXY_URL` (this Worker's address) to the app, an owner switch, and the client that sends the person's token with each request.
