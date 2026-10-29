# Bestelling uit document + orderhistorie + AI-instellingen per functie

Datum: 2026-10-29
Status: goedgekeurd ontwerp, klaar voor implementatieplan

## Doel

Bij een leverancier een screenshot of pdf (orderbevestiging, proforma, factuur, eigen bestelling)
uploaden, waarna Claude een bestelling met meerdere regels klaarzet. De gebruiker controleert,
past aan, voegt regels toe en slaat op. Koppelingen die de gebruiker handmatig maakt of corrigeert
worden onthouden per leverancier. Daarnaast: een echte orderhistorie per leverancier met status
per order, en in Instellingen per AI-functie een model en max tokens kunnen kiezen.

## Uitgangspunten

- Fabrikanten gebruiken altijd hun eigen productcodes; koppelen op naam en kleur, alleen binnen
  de producten van deze leverancier (`active = 1 AND archived = 0`).
- Onzekere regels worden gemarkeerd, nooit stil gegokt.
- Verwachte aankomst wordt niet automatisch ingevuld; blijft een handmatig veld.
- Status wordt per order bijgehouden (besteld / verzonden / ontvangen), niet per regel.
- Het geüploade bestand wordt nergens opgeslagen; alleen in geheugen doorgestuurd naar Claude.
- Alles wordt in één keer gebouwd.

## Huidige situatie (relevant)

- `purchase_orders` bevat per rij één product met eigen status/datums; formulier
  "Bestelling registreren" in `app/suppliers/[id]/page.tsx` maakt één rij per keer.
- Er is geen UI om de status te wijzigen; alles blijft `ordered` en telt dus eeuwig als onderweg
  in `lib/stock-status.ts` en `lib/order-calculator.ts`.
- `app/api/events/lookup/route.ts` gebruikt hardcoded `claude-haiku-4-5-20251001` en
  `max_tokens: 1024`; de setting `ai_max_tokens_per_lookup` wordt nergens toegepast.
- Tokenverbruik wordt opgeteld in settings `ai_total_input_tokens` / `ai_total_output_tokens`;
  `ai_token_cap` begrenst het totaal.

## Datamodel

### Nieuwe tabel `orders`

| kolom | type | opmerking |
|---|---|---|
| id | INTEGER PK | |
| supplier_id | INTEGER NOT NULL → suppliers | |
| order_date | TEXT NOT NULL | YYYY-MM-DD |
| supplier_ref | TEXT | ordernummer van de fabrikant, optioneel |
| expected_arrival | TEXT | handmatig |
| status | TEXT NOT NULL DEFAULT 'ordered' | `ordered` / `shipped` / `received` |
| notes | TEXT | |
| created_at | DATETIME DEFAULT CURRENT_TIMESTAMP | |

### `purchase_orders` → orderregels

Nieuwe kolommen:
- `order_id INTEGER REFERENCES orders(id)`
- `supplier_code TEXT` — code van de fabrikant
- `supplier_description TEXT` — omschrijving zoals op het document

De bestaande kolommen `status`, `order_date`, `expected_arrival`, `notes` op regelniveau worden
niet meer gelezen; de order is leidend.

### Nieuwe tabel `supplier_product_aliases`

| kolom | type | opmerking |
|---|---|---|
| id | INTEGER PK | |
| supplier_id | INTEGER NOT NULL → suppliers | |
| alias_key | TEXT NOT NULL | genormaliseerde code, of `name:` + genormaliseerde omschrijving als er geen code is |
| supplier_code | TEXT | origineel |
| supplier_description | TEXT | laatst geziene omschrijving |
| product_id | INTEGER NOT NULL → products | |
| updated_at | DATETIME | |

`UNIQUE(supplier_id, alias_key)`; upsert bij opslaan.

Normalisatie (in `lib/order-import.ts`, pure functie): trim, lowercase, whitespace samenvoegen;
voor codes ook spaties/streepjes/punten verwijderen.

### Migratie

Idempotent, in de bestaande migratiestijl van `lib/db.ts`:
1. Tabellen `orders` en `supplier_product_aliases` aanmaken.
2. Kolommen aan `purchase_orders` toevoegen.
3. Voor elke `purchase_orders`-rij zonder `order_id`: een `orders`-rij maken met
   supplier_id, order_date, expected_arrival, status, notes van die regel en `order_id` zetten.
4. Settings migreren (zie Instellingen).

### "Onderweg"-query's

`lib/stock-status.ts` en `lib/order-calculator.ts` lezen voortaan via een join:

```sql
SELECT po.quantity, o.expected_arrival
FROM purchase_orders po JOIN orders o ON o.id = po.order_id
WHERE po.product_id = ? AND o.status IN ('ordered', 'shipped')
```

## API

- `GET /api/orders?supplier_id=&status=open|all` — orders met hun regels (incl. productnaam/SKU).
- `POST /api/orders` — `{ supplier_id, order_date, supplier_ref?, expected_arrival?, notes?, lines: [{ product_id, quantity, supplier_code?, supplier_description?, remember? }] }`.
  Maakt order + regels in één transactie; upsert aliases voor regels met `remember: true`
  (frontend zet dit als de gebruiker het product handmatig koos of wijzigde t.o.v. het voorstel).
- `PUT /api/orders` — idem met `id`; vervangt de regels. Ook gebruikt voor alleen statuswijziging
  (`{ id, status }`).
- `DELETE /api/orders` — `{ id }`; verwijdert order + regels.
- `POST /api/orders/import` — multipart: `supplier_id`, `file`. Valideert type
  (png, jpg, webp, pdf) en grootte (≤ 10 MB). Rate limit zoals de event lookup.
  Response:
  ```json
  {
    "order_date": "2026-10-12" | null,
    "supplier_ref": "PI-4521" | null,
    "lines": [{ "supplier_code": "...", "supplier_description": "...", "quantity": 120,
                "product_id": 42 | null, "match": "memory" | "confident" | "uncertain" | "none" }],
    "truncated": false
  }
  ```
- `GET /api/ai/models` — beschikbare modellen via Anthropic Models API met de opgeslagen key;
  bij fout een vaste fallbacklijst.
- `app/api/purchase-orders` verdwijnt; alle consumers gaan naar `/api/orders`.

## Analyse (aanpak A)

`lib/order-import.ts`:
1. Producten van de leverancier (`active = 1 AND archived = 0`) en diens aliases ophalen.
2. Eén Claude-aanroep met het document (image- of document-block, base64), de productlijst
   (id, SKU, naam) en de bekende aliases. Gestructureerde output via een tool met JSON-schema
   (`order_date`, `supplier_ref`, `lines[]` met code, omschrijving, aantal, `product_id|null`,
   `confidence: high|low`). Instructie: koppel op naam en kleur/variant, kies `null` bij twijfel
   tussen meerdere producten, verzin geen product_ids.
3. Server-side nabewerking:
   - `product_id` dat niet in de productlijst van de leverancier zit → `null`.
   - Alias-match op genormaliseerde code (of omschrijving bij geen code) wint altijd → `memory`.
   - Anders `high` → `confident`, `low` → `uncertain`, `null` → `none`.
4. `stop_reason === 'max_tokens'` → `truncated: true`, gevonden regels toch teruggeven.
5. Tokenverbruik registreren (totaal én per functie).

Model en max tokens komen uit de instellingen voor functie `order_import`.

## Schermen

### Bestelling registreren (leverancierspagina)

Paneel met:
- Uploadvak: slepen, plakken (Cmd+V) of kiezen; png/jpg/webp/pdf ≤ 10 MB; laadstatus tijdens analyse.
- Ordergegevens: besteldatum (standaard vandaag, of uit document), ordernummer fabrikant,
  verwachte aankomst (handmatig), notities.
- Regeltabel: fabrikantcode + omschrijving (info), productkeuze (producten van deze leverancier),
  aantal, verwijderknop; "+ Regel toevoegen".
- Markering per regel: groen = uit geheugen, geel = Claude twijfelt, rood = niet gekoppeld.
- Opslaan pas mogelijk als elke regel een product en een aantal ≥ 1 heeft.
- Werkt ook zonder upload (handmatig regels invullen).
- Bij opslaan: regels met fabrikantcode/omschrijving waarvan het product handmatig gekozen of
  gewijzigd is, krijgen `remember: true`.

De orderformulier-logica gaat naar een eigen component (`components/OrderForm.tsx`) zodat
`app/suppliers/[id]/page.tsx` (nu ~1660 regels) niet verder groeit; idem de historie
(`components/OrderHistory.tsx`).

### Bestellingen (orderhistorie, onderaan leverancierspagina)

- Kaart per order: datum, ordernummer, aantal regels, totaal stuks, verwachte aankomst, status.
- Uitklappen toont de regels.
- Status wijzigen (besteld → verzonden → ontvangen), bewerken (zelfde formulier zonder upload),
  verwijderen (met bevestiging).
- Filter "Openstaand" (standaard) / "Alles".
- "Verwacht in Xd" en `getOrdersForProduct` gebruiken de nieuwe ordergegevens.

## Instellingen

Blok "Per functie" onder Claude AI:

| Functie | settings-keys | standaard |
|---|---|---|
| Datum opzoeken (events) | `ai_model_event_lookup`, `ai_max_tokens_event_lookup` | `claude-haiku-4-5-20251001`, 1024 |
| Bestelling uit document | `ai_model_order_import`, `ai_max_tokens_order_import` | `claude-sonnet-5-5`, 4096 |

- Modelkeuzelijst gevuld via `GET /api/ai/models`.
- `ai_max_tokens_per_lookup` vervalt; bestaande waarde wordt `ai_max_tokens_event_lookup`
  met minimum 1024 (web search heeft ruimte nodig).
- De nieuwe keys worden toegevoegd aan de whitelist in `app/api/settings/route.ts`;
  `ai_max_tokens_per_lookup` gaat eruit.
- `app/api/events/lookup/route.ts` leest model en max tokens uit deze settings.
- Tokenverbruik per functie: `ai_tokens_<functie>_input` / `_output`, naast het bestaande totaal.
  Getoond in het tokenoverzicht. `ai_token_cap` blijft gelden voor het totaal.
- Gedeelde helpers (`getSettingInt`, `addTokenUsage`, API-key ophalen, cap-check) verhuizen naar
  `lib/ai.ts` zodat beide routes ze gebruiken.

## Foutafhandeling

- Geen API-key / limiet bereikt / bestand te groot of verkeerd type → duidelijke melding;
  formulier blijft handmatig bruikbaar.
- Claude kan het document niet lezen of vindt geen regels → "Geen regels gevonden", lege vorm.
- Afgekapt antwoord → melding "verhoog max tokens in Instellingen" + gevonden regels.
- Fouten worden gelogd via `lib/logger.ts`.

## Testen

- Vitest toevoegen (devDependency, `npm test`).
- Unit tests: normalisatie van codes/omschrijvingen; nabewerking (alias wint, ongeldige
  product_id → null, confidence-mapping); migratie van oude `purchase_orders` naar `orders`
  (in-memory SQLite); "onderweg"-berekening telt `received` niet mee.
- Handmatig: `npm run build`, flow doorlopen in de app met een voorbeeld-pdf en een screenshot,
  koppeling corrigeren en opnieuw importeren om het geheugen te controleren.

## Buiten scope

- Status per regel / deelleveringen.
- Bestanden bewaren bij de order.
- Automatisch invullen van verwachte aankomst.
