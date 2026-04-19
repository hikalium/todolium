# todolium Design Document

## 概要

todolium は hikalium が個人利用するためのオフラインファースト ToDo 管理 Web アプリ。
ネットワーク不在時はローカルストレージで完全動作し、サーバーに接続できた時点でイベントログを同期する。

---

## 使用技術

| レイヤー | 技術 |
|---|---|
| サーバーサイド言語 | TypeScript (ES2022 モジュール) |
| サーバーフレームワーク | Express.js (HTTP API のみ、Socket.IO は廃止) |
| クライアントサイド | Vanilla JavaScript |
| スタイリング | 素の CSS |
| フォント | Source Code Pro (Google Fonts) |
| サーバーデータ永続化 | JSONL ファイル (`events.jsonl`) |
| クライアントデータ | localStorage |
| ビルド | TypeScript Compiler (`tsc`) |
| ランタイム | Node.js (ES Module モード) |
| テスト | Node.js 組み込み `node:test` (予定) |

---

## コアアーキテクチャ: イベントソーシング + チェーン型競合解決

### 基本方針

「現在の状態（リスト）」を保存するのではなく、**操作のイベントログを追記専用で保存**し、状態はそこから導出する。

- イベントは追記のみ・変更なし・削除なし（イミュータブル）
- 各タスクはイベントのチェーン（連結リスト）で表現される
- マージは「イベント集合の和」であり、コンフリクトはチェーンのタイムスタンプ比較で解決

---

## イベントデータ構造

```typescript
type EventType = 'add_todo' | 'mark_done' | 'postpone' | 'revert';

interface TodoEvent {
  eid:        string;          // UUID v4: このイベント固有のID
  type:       EventType;
  at:         number;          // ms timestamp (クライアント時刻を信頼)
  device_id:  string;          // localStorage に永続化された匿名UUID
  task_id:    string;          // UUID v4: 対象タスクのID (add_todo で新規生成)
  parent_eid: string | null;   // 直前のイベントのeid (add_todo のみ null)

  // type 別の追加フィールド
  task?:      string;          // add_todo のみ: タスク名
  ms?:        number;          // postpone のみ: 延長するミリ秒数
}
```

### イベントごとのルール

| type | parent_eid | 追加フィールド | 意味 |
|---|---|---|---|
| `add_todo` | `null` | `task` | タスクの新規作成、deadline = at + 24h |
| `postpone` | 直前のeid | `ms` | deadline = at + ms |
| `mark_done` | 直前のeid | なし | タスクを完了状態にする |
| `revert` | 直前のeid | なし | mark_done を取り消し、直前の deadline を復元 |

---

## タスクのライフサイクル

```
[add_todo] → [postpone] → [postpone] → [mark_done] → [revert] → [mark_done]
```

- `mark_done` → `revert` でアクティブに戻った時の deadline は、チェーンを遡って `mark_done` 直前の有効な deadline を復元する
- どのイベントも「最新タイムスタンプが常に優先」というルールが一貫して適用される

---

## チェーン型競合解決

### フォーク（分岐）の発生

同じ `parent_eid` を持つ複数のイベントが存在する場合、チェーンが分岐している。

```
[E1: add_todo, task_id=T1, at=100]
    ↓ parent_eid=E1
[E2: postpone, at=200]  ← デバイスAがオフライン時に作成
    ↓ parent_eid=E1
[E3: mark_done, at=250] ← デバイスBがオフライン時に作成
```

### 解決アルゴリズム

1. 同じ `parent_eid` を持つイベントを「フォーク候補」として検出
2. `at`（タイムスタンプ）が最も新しいイベントを **勝者** とする
3. 負けたイベントを起点とするチェーン（子孫すべて）を破棄
4. タスクごとに独立して解決する（タスク間の依存関係なし）

```
マージ前: {E1, E2(at=200), E3(at=250), E4(parent=E2, at=210)}
解決:     E2 vs E3 → E3 が勝ち
マージ後: {E1, E3}  ← E2, E4 は破棄
```

### 冪等性

同一 `eid` のイベントは重複除去するだけ。同じ同期を 2 回行っても状態は変わらない。

---

## 状態導出ロジック（純粋関数）

```typescript
function deriveState(events: TodoEvent[]): TodoState {
  // 1. mergeChains でフォーク解決済みのイベント列を得る
  // 2. at 昇順でソートして replay
  // 3. add_todo でタスク生成
  // 4. postpone で deadline 更新
  // 5. mark_done で done_at 設定
  // 6. revert で done_at 削除・deadline 復元
  // 7. todo_list (deadline昇順) と done_list (done_at降順) を返す
}

function mergeChains(local: TodoEvent[], remote: TodoEvent[]): TodoEvent[] {
  // 1. union（eid で重複除去）
  // 2. タスクごとにグループ化
  // 3. 各タスクのチェーン内フォークを解決
  // 4. 有効なイベントのみを返す
}
```

これらは**純粋関数**（副作用なし）として実装し、ユニットテスト対象とする。

---

## ストレージ

### サーバー側: `events.jsonl`

1行1イベントの JSONL 形式で追記のみ。

```jsonl
{"eid":"uuid1","type":"add_todo","at":1700000000000,"device_id":"dev-uuid","task_id":"task-uuid","parent_eid":null,"task":"PR review"}
{"eid":"uuid2","type":"mark_done","at":1700000100000,"device_id":"dev-uuid","task_id":"task-uuid","parent_eid":"uuid1"}
```

**起動時の検証**:
- ファイルが存在しない → 空ファイルを新規作成して起動
- ファイルが存在し各行が `TodoEvent` としてパース可能 → 正常起動
- ファイルが存在するが旧形式（`todo.json` 等）→ エラーメッセージを出力して `process.exit(1)`

### クライアント側: localStorage

```javascript
localStorage['todolium_device_id']  // 起動時に生成した匿名UUID (永続)
localStorage['todolium_events']     // JSON.stringify(TodoEvent[])
```

---

## HTTP 同期 API

### Socket.IO から HTTP ポーリングへの移行判断

当初の実装では Socket.IO による常時 WebSocket 接続を採用していたが、以下の理由で HTTP ポーリングに切り替える。

**HTTP ポーリングを選択した理由:**

| 観点 | Socket.IO | HTTP ポーリング |
|---|---|---|
| オフラインファーストとの相性 | 「常時接続」が前提のため、切断状態の管理が複雑になる | 各同期が独立したリクエスト。接続状態の管理不要 |
| テスト容易性 | イベントの順序・タイミングを含むモックが複雑 | リクエスト/レスポンスの単純な構造でモックが簡単 |
| 将来の PWA 対応 | Service Worker との統合が難しい | `fetch` ベースのため Service Worker と自然に統合できる |
| 実装の複雑さ | 接続管理・再接続ロジックが必要 | `fetch` + `setInterval` のみでシンプルに実装できる |
| ユーザー体験への影響 | 即時プッシュが可能 | 数秒のポーリング間隔があるが、個人用 todo アプリでは問題なし |

Socket.IO の唯一の優位点は「別デバイスへの即時プッシュ」だが、オフラインファーストの設計において数秒の遅延は許容範囲内であり、実装の単純さを優先する。

---

### API 設計

Socket.IO は廃止し、シンプルな HTTP REST に移行する。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/api/events` | サーバーの全イベントを返す |
| `POST` | `/api/events` | クライアントから新規イベントを送信 (配列) |

### 同期フロー

```
1. クライアントが /api/events GET → サーバーの全イベントを取得
2. mergeChains(localStorage_events, server_events) で状態を導出・表示
3. ローカルにある未送信イベントを POST /api/events で送信
4. 上記を N 秒ごとにポーリング（オンライン時）
5. fetch が失敗したらオフラインモードに切り替え（ローカルのみで動作継続）
```

---

## テスト対象パターン

| # | シナリオ | 検証内容 |
|---|---|---|
| T1 | add → postpone → mark_done | done_list に移動、Took が正しい |
| T2 | 2デバイスが別タスクをオフラインで追加してマージ | 両タスクが todo_list に存在 |
| T3 | 2デバイスが同一タスクを同時 postpone (新しい方が勝つ) | 新しい at の deadline が採用される |
| T4 | デバイスA が mark_done (at=250)、デバイスB が postpone (at=200) → マージ | Bの postpone チェーンが破棄、done が残る |
| T5 | 同一イベントを 2 回同期 (冪等性) | 状態変化なし |
| T6 | mark_done 後に revert → deadline が復元される | mark_done 直前の deadline に戻る |
| T7 | revert 同士の競合 (2デバイスで revert) | 新しい at の revert が採用 |

---

## 実装マイルストーン

### Milestone 1: コアロジックの実装とテスト

**目標**: サーバーもUIも触らず、純粋関数としてのイベントエンジンを完成させてテストで品質を担保する。

**実装内容**:
- `src/types.ts` — `TodoEvent`, `TodoState`, `Task` 型定義
- `src/engine.ts` — `deriveState()`, `mergeChains()`, `resolveConflict()` の実装
- `src/engine.test.ts` — T1〜T7 の全パターンのユニットテスト (`node:test`)
- `package.json` の `test` スクリプトを `node --test` に更新

**完了条件**: `npm test` で T1〜T7 が全て green になること。

---

### Milestone 2: クライアントのローカルオンリーモード化

**目標**: サーバーなしでブラウザ単体で完全動作するようにする。Socket.IO を除去。

**実装内容**:
- `client.js` を書き直し
  - 起動時に `localStorage['todolium_device_id']` を確認、なければ UUID を生成・保存
  - `localStorage['todolium_events']` からイベントを読み込み、`deriveState()` で表示
  - 入力・Done!・+Nd・revert ボタン操作時に新規 `TodoEvent` を生成して localStorage に追記し、状態を再導出して再描画
  - `parent_eid` は当該タスクの最新イベントの `eid` を設定
- `index.html` から socket.io の `<script>` タグを削除
- `index.html` に engine.js (または inline) を追加

**完了条件**: サーバー不要でブラウザ上でタスクの追加・完了・延期・revert が動作し、リロード後もデータが保持されること。

---

### Milestone 3: サーバー同期モードの追加

**目標**: サーバーが起動していれば自動同期し、オフライン時はローカルで継続動作する。

**実装内容**:
- `server.ts` を書き直し
  - `events.jsonl` の読み込み・検証（旧形式は `process.exit(1)`）
  - `GET /api/events` — 全イベントを JSON 配列で返す
  - `POST /api/events` — イベント配列を受け取り `events.jsonl` に追記
  - 静的ファイル配信は継続
  - Socket.IO 依存を削除
- `client.js` に同期レイヤーを追加
  - 5 秒ごとに `GET /api/events` → `mergeChains()` → 再描画
  - ローカルの未送信イベントを `POST /api/events` で送信
  - `fetch` 失敗時はオフラインモードに移行（UI にインジケーター表示）

**完了条件**:
- 2つのブラウザウィンドウで同じサーバーに接続し、一方の操作が数秒以内に他方に反映される
- ネットワークを切断した状態でも操作でき、再接続後に同期される
- 旧形式の `todo.json` が存在する場合にサーバーがエラー終了する

---

## 既知の制限（将来の課題）

- **イベントログ圧縮**: 当面は無限追記。将来的に done タスクを snapshot に圧縮する
- **タイムスタンプ精度**: クライアント時刻を信頼。意図的な時刻操作には対応しない
- **認証なし**: 個人利用前提。外部公開する場合は別途対応が必要
