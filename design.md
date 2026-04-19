# todolium Design Document

## 概要

todolium は hikalium が個人利用するためのオフラインファースト ToDo 管理 Web アプリ。
ネットワーク不在時はローカルストレージで完全動作し、サーバーに接続できた時点でイベントログを同期する。

---

## 使用技術

| レイヤー | 技術 |
|---|---|
| サーバーサイド言語 | TypeScript (ES2022 モジュール) |
| サーバーフレームワーク | Express.js (HTTP API のみ) |
| クライアントサイド | Vanilla JavaScript |
| スタイリング | 素の CSS |
| フォント | Source Code Pro (Google Fonts) |
| サーバーデータ永続化 | JSONL ファイル (`events.jsonl`) |
| クライアントデータ | localStorage |
| ビルド | TypeScript Compiler (`tsc`) |
| ランタイム | Node.js (ES Module モード) |
| テスト | Node.js 組み込み `node:test` |

---

## アーキテクチャ概観

```
ブラウザ (client.js + localStorage)
    ↕ HTTP polling（5秒ごと、オンライン時のみ）
Express サーバー (server.ts)
    ↕ 追記のみ
events.jsonl
```

設計の 3 原則:

1. **オフラインファースト** — サーバーに到達できなくてもブラウザ単体で全操作が完結する
2. **イベントソーシング** — 「現在の状態」ではなく「操作のログ」を保存し、状態はそこから毎回導出する
3. **イミュータブルなイベント** — 一度記録したイベントは変更も削除もしない。これにより複数デバイス間の同期が「集合の和」で解決できる

---

## イベントモデル

### なぜイベントログか

通常の ToDo アプリは「現在のタスク一覧」をそのまま保存する。しかしこの方式では、オフライン中に複数デバイスが独立して変更を行った際に「どちらが正しい状態か」を判断できない。

イベントログ方式では「何をしたか」の記録を追記するだけなので、二つのデバイスのログをマージするだけでよい。イベントはイミュータブルなので、マージは常に「和集合 + 重複除去」で解決する。

### イベントの型定義

```typescript
type EventType = 'add_todo' | 'edit_task' | 'postpone' | 'mark_done' | 'revert';

interface TodoEvent {
  eid:        string;        // このイベント固有のUUID
  type:       EventType;
  at:         number;        // 操作時刻（ms timestamp、クライアント時刻を信頼）
  device_id:  string;        // 操作したデバイスの匿名UUID
  task_id:    string;        // 対象タスクのUUID（add_todo では新規生成）
  parent_eid: string | null; // 直前のイベントの eid（add_todo のみ null）

  task?: string;             // add_todo / edit_task のみ
  ms?:   number;             // postpone のみ: 延長するミリ秒数
}
```

各フィールドが必要な理由:

| フィールド | 必要な理由 |
|---|---|
| `eid` | `parent_eid` が「どのイベントを起点に操作したか」を指すために、各イベントに固有IDが必要。`(task_id, at)` の組では同ミリ秒に複数イベントが存在した場合に区別できない |
| `at` | フォーク発生時に「どちらが新しい操作か」を判断する唯一の基準 |
| `device_id` | デバッグ・トレース用。どのデバイスの操作かを追跡できる |
| `task_id` | タスクごとに独立したチェーンを持つため、タスクを識別する UUID が必要 |
| `parent_eid` | チェーンの連結に使う。このイベントを生成した時点でデバイスが認識していた「最新の状態」を示し、フォーク検出の鍵となる |

### イベント種別一覧

| type | parent_eid | 追加フィールド | 処理 |
|---|---|---|---|
| `add_todo` | `null` | `task` | タスク新規作成。deadline = at + 24h |
| `edit_task` | 直前の eid | `task` | タスク名を変更する |
| `postpone` | 直前の eid | `ms` | deadline = at + ms |
| `mark_done` | 直前の eid | なし | タスクを完了状態にする |
| `revert` | 直前の eid | なし | mark_done を取り消し、直前の deadline を復元 |

---

## タスクのライフサイクル

イベントチェーンの例:

```
[add_todo] → [edit_task] → [postpone] → [mark_done] → [revert] → [mark_done]
```

各状態の導出ルール:

- **タスク名**: チェーン上で最後に現れる `add_todo` または `edit_task` の `task` フィールド
- **deadline**: チェーン上で最後に現れる `add_todo` または `postpone` の値
- **完了状態**: `mark_done` で完了、`revert` で取り消し。`revert` 時の deadline は `mark_done` 直前の deadline を復元
- **競合**: どのイベント種別でも「タイムスタンプが新しい方が常に優先」というルールを一貫して適用

---

## 競合解決

### フォークの発生

同じ `parent_eid` を持つ複数のイベントが存在するとき、チェーンが分岐（フォーク）している。これはデバイスがオフライン中に独立して操作を行った場合に起きる。

```
[E1: add_todo, task_id=T1, at=100]
    ↓ parent_eid=E1        ↓ parent_eid=E1
[E2: postpone, at=200]  [E3: mark_done, at=250]
    ↓ parent_eid=E2
[E4: postpone, at=210]
```

デバイスAはE2→E4と操作し、デバイスBはE3を作成した。マージ時にフォークを解決する。

### 解決アルゴリズム

1. 同じ `parent_eid` を持つイベント群を「フォーク候補」として検出
2. `at` が最も新しいイベントを **勝者** とする
3. 敗者イベントを起点とするチェーン（子孫すべて）を破棄
4. タスクごとに独立して解決する（タスク間の依存関係なし）

```
E2(at=200) vs E3(at=250) → E3 が勝ち
マージ後: {E1, E3}  ← E2, E4 は破棄
```

### 冪等性

同一 `eid` のイベントは重複除去するだけ。同じ同期を複数回行っても状態は変わらない。

---

## 状態導出（純粋関数）

競合解決と状態導出は副作用のない純粋関数として実装する。I/O から切り離すことでユニットテストが容易になる。

```typescript
// イベントログ全体から現在の表示状態を導出する
function deriveState(events: TodoEvent[]): TodoState {
  // 1. mergeChains() でフォーク解決済みのイベント列を得る
  // 2. at 昇順でソートして replay
  // 3. add_todo    → タスク生成、deadline = at + 24h
  // 4. edit_task   → タスク名更新
  // 5. postpone    → deadline 更新
  // 6. mark_done   → done_at 設定
  // 7. revert      → done_at 削除、deadline を mark_done 直前の値に復元
  // 8. todo_list (deadline昇順)、done_list (done_at降順) を返す
}

// ローカルとリモートのイベントをマージし、フォークを解決して有効なイベント列を返す
function mergeChains(local: TodoEvent[], remote: TodoEvent[]): TodoEvent[] {
  // 1. eid で重複除去（和集合）
  // 2. task_id ごとにグループ化
  // 3. 各タスクのチェーン内フォークを解決
  // 4. 有効なイベントのみを返す
}
```

---

## ストレージ

### サーバー側: `events.jsonl`

1行1イベントの JSONL 形式。追記のみで変更・削除は行わない。

```jsonl
{"eid":"uuid1","type":"add_todo","at":1700000000000,"device_id":"dev-uuid","task_id":"task-uuid","parent_eid":null,"task":"PR review"}
{"eid":"uuid2","type":"mark_done","at":1700000100000,"device_id":"dev-uuid","task_id":"task-uuid","parent_eid":"uuid1"}
```

**起動時の検証**:
- ファイルが存在しない → 空ファイルを新規作成して起動
- 各行が `TodoEvent` としてパース可能 → 正常起動
- 旧形式（`todo.json` 等）→ エラーを出力して `process.exit(1)`

### クライアント側: localStorage

```
todolium_device_id  起動時に生成した匿名UUID（永続）
todolium_events     JSON.stringify(TodoEvent[])
```

---

## HTTP API と同期フロー

### エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/events` | サーバーの全イベントを JSON 配列で返す |
| `POST` | `/api/events` | イベント配列を受け取り `events.jsonl` に追記する |

### 同期フロー

```
① GET /api/events でサーバーの全イベントを取得
② mergeChains(localStorage, server) で状態を導出・再描画
③ ローカルにある未送信イベントを POST /api/events で送信
④ ①〜③ を 5 秒ごとに繰り返す（オンライン時）
⑤ fetch 失敗 → オフラインモードに切り替え（UI にインジケーター表示）
⑥ 次回 fetch 成功時に自動復帰、ローカルで溜まったイベントを送信
```

---

## テストパターン

`deriveState` と `mergeChains` に対してユニットテストで検証するシナリオ。

| # | シナリオ | 期待結果 |
|---|---|---|
| T1 | add → postpone → mark_done | done_list に移動、Took が正しい |
| T2 | 2デバイスが別タスクをオフラインで追加してマージ | 両タスクが todo_list に存在 |
| T3 | 2デバイスが同一タスクを同時 postpone（新しい方が勝つ） | 新しい at の deadline が採用される |
| T4 | A が mark_done(at=250)、B が postpone(at=200) → マージ | B の postpone チェーンが破棄、done が残る |
| T5 | 同一イベントを 2 回同期（冪等性） | 状態変化なし |
| T6 | mark_done 後に revert | mark_done 直前の deadline に戻る |
| T7 | revert 同士が競合（2デバイスで revert） | 新しい at の revert が採用 |
| T8 | edit_task(at=200) と mark_done(at=250) が競合 | mark_done が勝ち、edit は破棄 |
| T9 | edit_task(at=300) と mark_done(at=250) が競合 | edit が勝ち、todo のまま名前が変わる |

---

## 実装マイルストーン

### Milestone 1: コアエンジンの実装とテスト

**目標**: サーバーも UI も変更せず、純粋関数としてのイベントエンジンを完成させてテストで品質を担保する。

**実装内容**:
- `src/types.ts` — `TodoEvent`、`TodoState`、`Task` の型定義
- `src/engine.ts` — `deriveState()`、`mergeChains()` の実装
- `src/engine.test.ts` — T1〜T9 の全パターンのユニットテスト（`node:test`）
- `package.json` の `test` スクリプトを `node --test` に更新

**完了条件**: `npm test` で T1〜T9 が全て green になること。

---

### Milestone 2: クライアントのローカルオンリーモード化

**目標**: サーバーなしでブラウザ単体で完全動作するようにする。Socket.IO を除去。

**実装内容**:
- `client.js` を書き直し
  - 起動時に `todolium_device_id` を確認、なければ UUID を生成・保存
  - `todolium_events` を読み込み `deriveState()` で表示
  - 操作ごとに `TodoEvent` を生成して localStorage に追記し、状態を再導出して再描画
  - `parent_eid` はそのタスクの最新イベントの `eid` を設定
- `index.html` から Socket.IO の `<script>` を削除、engine.js を追加

**完了条件**: サーバー不要でタスクの追加・完了・延期・名前変更・revert が動作し、リロード後もデータが保持されること。

---

### Milestone 3: サーバー同期モードの追加

**目標**: サーバーが起動していれば自動同期し、オフライン時はローカルで継続動作する。

**実装内容**:
- `server.ts` を書き直し
  - `events.jsonl` の読み込み・検証（旧形式は `process.exit(1)`）
  - `GET /api/events`、`POST /api/events` を実装
  - 静的ファイル配信は継続、Socket.IO 依存を削除
- `client.js` に同期レイヤーを追加
  - 5 秒ごとにポーリング、未送信イベントを送信
  - `fetch` 失敗時はオフラインモードに移行（UI にインジケーター表示）

**完了条件**:
- 2つのブラウザで同じサーバーに接続し、一方の操作が数秒以内に他方に反映される
- オフライン中も操作でき、再接続後に同期される
- 旧形式の `todo.json` が存在する場合にサーバーがエラー終了する

---

## テクニカルディスカッション

設計上の選択肢を比較検討した記録。

### D1: タスク内容（タイトル）の編集方式

**採用: `edit_task` をチェーン内の通常イベントとして追加**

検討した 3 案:

**案 X — イベントをミュータブルにする（却下）**

`events.jsonl` の既存行を直接書き換える方式。実装は直感的だが、JSONL の「追記のみ」原則が崩れ、同期時に「どちらのバージョンが新しいか」を別途管理しなければならない。オフライン競合解決が根本から複雑になるため却下。

**案 Y — `supersede` ポインター（却下）**

```
[add_todo,  task_id=T1, task="Buy milk"]
[supersede, task_id=T2, inherits=T1, task="Buy oat milk"]
```

タスクの「同一性」と「内容」を分離できるが、T1/T2 のイベントを横断して replay する必要があり状態導出が複雑になる。「タスク間の依存関係なし」という方針とも矛盾するため却下。

**案 Z — `edit_task` をチェーン内の通常イベントとして追加（採用）**

```
[add_todo,  eid=E1, task="Buy milk",      parent_eid=null]
[edit_task, eid=E2, task="Buy oat milk",  parent_eid=E1]
[mark_done, eid=E3,                        parent_eid=E2]
```

既存の競合解決アルゴリズムが変更ゼロでそのまま適用される。タスク名は「勝者チェーン上で最後に現れる `add_todo` または `edit_task` の `task` フィールド」として導出する。

競合例:
```
E1(add_todo) を親として:
  E2: edit_task(at=200)  ← デバイスA
  E3: mark_done(at=250)  ← デバイスB

→ E3 が勝ち。タスクは done、名前は変更前のまま。
```

---

### D2: 同期方式の選択

**採用: HTTP ポーリング（Socket.IO から移行）**

| 観点 | Socket.IO | HTTP ポーリング |
|---|---|---|
| オフラインファーストとの相性 | 「常時接続」が前提で切断状態の管理が複雑 | 各同期が独立したリクエスト。接続状態の管理不要 |
| テスト容易性 | イベントの順序・タイミングのモックが複雑 | リクエスト/レスポンスの構造でモックが簡単 |
| 将来の PWA 対応 | Service Worker との統合が難しい | `fetch` ベースで Service Worker と自然に統合できる |
| 実装の複雑さ | 接続管理・再接続ロジックが必要 | `fetch` + `setInterval` のみ |
| リアルタイム性 | 即時プッシュが可能 | 数秒のポーリング間隔（個人用 todo アプリでは許容範囲） |

Socket.IO の優位点は「即時プッシュ」のみだが、オフラインファーストの設計において数秒の遅延は許容範囲内。実装の単純さを優先して HTTP ポーリングを採用。

---

## 既知の制限（将来の課題）

- **イベントログ圧縮**: 当面は無限追記。将来的に古い done タスクを snapshot に圧縮する
- **タイムスタンプ精度**: クライアント時刻を信頼。意図的な時刻操作には対応しない
- **認証なし**: 個人利用前提。外部公開する場合は別途対応が必要

---

## Milestone 4–6: モバイル UI とドラッグ並び替え

### 背景と設計方針

**締め切り = 表示順序** という todolium の核心的設計を活かし、タスクをドラッグして別の位置に挿入したとき、自動的に締め切りを再計算する機能を追加する。

依存ライブラリは増やさない。ドラッグはブラウザ標準の Pointer Events API（`pointerdown` / `pointermove` / `pointerup`）で実装する。マウスとタッチ両方に対応できる唯一の標準 API であり、HTML5 Drag and Drop API よりもモバイルでの挙動が安定している。

---

### Milestone 4: レスポンシブ CSS

**目標**: 既存の見た目・機能を維持しながら、スマホ画面（≤480px）でも快適に操作できるようにする。

**実装内容**:

1. `index.html` に `<meta name="viewport" content="width=device-width, initial-scale=1">` を追加
2. `index.css` にブレークポイント `@media (max-width: 480px)` を追加:
   - タスク行: `display: flex; flex-wrap: wrap;` でボタン群とタスク名を折り返し可能にする
   - ボタン: `min-height: 44px` （Apple HIG の最小タッチターゲット）
   - `.todolium-span-task`: 幅いっぱいに広がるよう `width: 100%` でボタン群と別行に
   - フォントサイズ: 画面幅に合わせて調整（`font-size: clamp(16px, 4vw, 24px)`）
   - **postpone ボタン（+1d/+2d/+4d/+8d）はモバイル幅では `display: none`** — 並び替えで代替するため
3. フォント・色・ボーダースタイルは既存のまま維持

**完了条件**:
- ブラウザの DevTools で iPhone SE（375px幅）に切り替えてもタスクが読める
- ボタンが小さすぎてタップできない状態が解消されている
- PC 幅では見た目が変わらない

---

### Milestone 5: ドラッグによる並び替えと締め切り補間

**目標**: todo リストのタスクを指でドラッグして並び替えると、挿入位置の隣タスクの締め切りを補間して新しい締め切りを自動設定する。

#### ドラッグの実装（Pointer Events API）

```
pointerdown → ドラッグ開始。タスク要素を "掴む"
pointermove → 画面座標からドロップ先候補を判定し、挿入インジケーター（細い横線）を表示
pointerup   → ドロップ確定。締め切り補間を計算し postpone イベントを発行
```

ドラッグ中は `setPointerCapture()` でポインターを掴んだ要素に固定し、要素外へ出ても追跡できるようにする。

ドラッグハンドルとして各タスク行の**右端**に `⠿`（U+28FF）を配置する。CSS `touch-action: none` をハンドル要素に設定してタッチスクロールを抑制する。ハンドル以外の領域（ボタン・タスク名）はクリック・タップ操作を維持する。

#### 補間関数のシグネチャ（engine.ts）

```typescript
// 挿入位置の上下タスクを受け取り、挿入するタスクに割り当てる deadline を返す。
// above=null は先頭への挿入、below=null は末尾への挿入を表す。
export function calculateInsertionDeadline(above: Task | null, below: Task | null): number;
```

内部ロジック:
- `above=null` → `below.deadline - DAY_MS`（先頭: 先頭タスクの固定 -1日）
- `below=null` → `above.deadline + DAY_MS`（末尾: 末尾タスクの固定 +1日）
- それ以外 → `Math.floor((above.deadline + below.deadline) / 2)`（中間値）
- 同一 deadline の場合（差 < 60,000ms）→ `Math.floor((above.deadline + below.deadline) / 2)` のまま（最小 30 秒ずれる）

UI 側は `todoList[dropIndex - 1] ?? null` と `todoList[dropIndex] ?? null` を渡すだけでよい。

#### 締め切り補間アルゴリズム

```
todo リスト: [A(d1), B(d2), C(d3), D(d4), E(d5)]  ← deadline 昇順
タスク D を A と B の間にドロップした場合:

  新しい deadline = floor((d1 + d2) / 2)

端にドロップした場合:
  先頭（A の上）→  d1 - 24h   ← 先頭タスクの固定 -1日
  末尾（E の下）→  d5 + 24h   ← 先頭タスクの固定 +1日
```

隣接する2タスクの締め切りが同一の場合（差が0）は最小ギャップ 1 分（60,000ms）を確保し、ドロップ先を `d_neighbor - 30s` / `d_neighbor + 30s` で分割する。

`postpone` イベントで絶対時刻を指定する方法:
- `ms = targetDeadline - now`（`deadline = at + ms = now + (targetDeadline - now) = targetDeadline`）
- 既存の `postpone` イベント型・エンジンロジックをそのまま流用できる

**完了条件**:
- タスクをドラッグして別の位置に挿入すると、リストの順序が変わる
- 変更後の締め切りが隣タスクの中間値になっている（DevTools の localStorage で確認）
- モバイル（タッチ）でも動作する
- 外部ライブラリなし

---

### Milestone 6: エンジンテスト追加とポリッシュ

**目標**: 並び替えロジックをユニットテストで保護し、UX の細部を整える。

**実装内容**:

1. `src/engine.test.ts` に T10〜T12 を追加:
   - T10: ドラッグ後の postpone イベントで deadline が補間値に更新される
   - T11: 同一 deadline の2タスク間にドロップした場合、最小ギャップが確保される
   - T12: 先頭ドロップで `d_first - 24h`、末尾ドロップで `d_last + 24h` になる（期限超過タスクが先頭にある場合も含む）

2. UX ポリッシュ:
   - ドラッグ中のタスク要素に `opacity: 0.5` で半透明表示
   - 挿入位置インジケーターを青い横線（2px, `#1d68cd`）で表示
   - ドロップ後のアニメーション（`transition: transform 0.15s`）
   - スクロール中でもドラッグ継続できるよう `scroll-into-view` を適切に処理

3. `README.md` のスクリーンショットをモバイル版に更新（任意）

**完了条件**:
- `npm test` で T1〜T12 が全て green
- モバイルでドラッグしてもスクロールと競合しない

---

### D3: Pointer Events vs HTML5 Drag and Drop

| 観点 | HTML5 DnD (`draggable`) | Pointer Events |
|---|---|---|
| モバイルタッチ | iOS Safari では動作しない | ○ |
| 挿入位置の視覚フィードバック | ブラウザ依存のゴースト画像 | 完全に自前で制御 |
| スクロール中のドラッグ | 対応困難 | `setPointerCapture` + 手動スクロール |
| 実装量 | 少ない（デスクトップのみなら） | やや多い |
| ライブラリ不要 | ○ | ○ |

→ iOS 対応とフィードバック制御の観点から Pointer Events を採用。

---

### 確定した設計決定

**D4: モバイルでの postpone ボタン → 非表示**
`+1d / +2d / +4d / +8d` のボタンはモバイル幅（≤480px）では非表示にする。順序変更はドラッグ並び替えのみで行う。PC 幅では引き続き表示。

**D5: 先頭・末尾ドロップの締め切り計算**

| ドロップ位置 | 新しい deadline |
|---|---|
| 先頭（最上位タスクの上）| `d_first - 24h` — 固定 -1日 |
| 末尾（最下位タスクの下）| `d_last + 24h` — 固定 +1日 |

`floor((now + d_first) / 2)` 案は、先頭タスクがすでに大幅に期限超過している場合（`d_first` が過去）に `now` との中間が意図しない位置になるため却下。固定 ±1日 にすることで、既存タスクの deadline が過去・未来どちらでも常にリスト上の前後関係が保たれる。

これらのエッジケースはユニットテスト（T10〜T12）で必ず検証する。

**D6: イベント型 → `postpone` を流用、`set_deadline` は追加しない**
ドラッグ後の締め切り変更は既存の `postpone` イベントで表現する。`ms = targetDeadline - now` とすれば `deadline = at + ms = now + (targetDeadline - now) = targetDeadline` となり、任意の絶対時刻を指定できる。イベント型を増やさずシンプルさを維持する。

**D7: 補間ロジックの配置 → `engine.ts` にエクスポート**
`calculateInsertionDeadline(above, below)` を `engine.ts` にエクスポートする純粋関数として実装する。「挿入位置に対して何ミリ秒の deadline を割り当てるか」は UI とは独立した決定論的ロジックであり、エンジン層に置くことでユニットテスト（T10〜T12）で直接検証できる。

**D8: `postpone` ms 計算のタイミングずれ → 許容範囲**
`ms = targetDeadline - Date.now()` を計算し `makeEvent` 内で再度 `Date.now()` が呼ばれるため数ミリ秒のずれが生じるが、秒単位の精度があれば十分なため問題なし。計算式のシンプルさを優先する。

**D9: タッチスクロールとドラッグの競合 → CSS `touch-action: none`**
各タスク行の右端にドラッグハンドル要素（`⠿`）を配置し、その要素に CSS `touch-action: none` を設定することでブラウザのデフォルトスクロールを抑制する。ハンドル以外の領域は通常のタッチスクロールを維持する。
