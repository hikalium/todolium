# todolium Design Document

## 概要

todolium は hikalium が個人利用するためのシンプルな ToDo 管理 Web アプリケーション。
リアルタイム通信を使ってブラウザ上でタスクの追加・完了・期限延長を操作できる。

---

## 使用技術

| レイヤー | 技術 |
|---|---|
| サーバーサイド言語 | TypeScript (ES2022 モジュール) |
| サーバーフレームワーク | Express.js |
| リアルタイム通信 | Socket.IO |
| クライアントサイド | Vanilla JavaScript (バンドルなし) |
| スタイリング | 素の CSS |
| フォント | Source Code Pro (Google Fonts) |
| データ永続化 | ローカルの JSON ファイル (`todo.json`) |
| ビルド | TypeScript Compiler (`tsc`) |
| ランタイム | Node.js (ES Module モード) |

---

## ディレクトリ構成

```
todolium/
├── server.ts          # サーバーのエントリポイント (TypeScript)
├── client.js          # クライアントサイドの JavaScript
├── index.html         # アプリの HTML
├── index.css          # スタイルシート
├── todo.json          # データストア (タスクの永続化)
├── tsconfig.json      # TypeScript コンパイラ設定
├── package.json       # npm 設定・依存関係
├── Makefile           # ビルド・実行・バックアップのショートカット
└── generated/
    ├── server.js      # tsc でコンパイルされたサーバーコード
    └── server.js.map  # ソースマップ
```

---

## アーキテクチャ

```
ブラウザ (index.html + client.js)
        |
        | WebSocket (Socket.IO)
        |
Node.js サーバー (server.ts / generated/server.js)
        |
        | 同期ファイル読み書き
        |
  todo.json (データストア)
```

- サーバーとクライアントは **Socket.IO による双方向通信** で繋がっている
- HTTP は静的ファイル配信のみに使用。API エンドポイントは存在しない
- データは **インメモリで保持**し、変更のたびに `todo.json` へ同期書き込み

---

## データモデル

`todo.json` のスキーマ:

```json
{
  "todo_list": [ Task ],
  "done_list": [ Task ]
}
```

Task オブジェクト:

| フィールド | 型 | 説明 |
|---|---|---|
| `id` | integer | タスクの一意 ID (サーバー起動時に最大値から採番) |
| `task` | string | タスク名 |
| `created_at` | integer (ms) | 作成日時のタイムスタンプ |
| `deadline` | integer (ms) | 期限のタイムスタンプ |
| `done_at` | integer (ms) | 完了日時 (done_list のみ) |

---

## Socket.IO イベント仕様

### クライアント → サーバー

| イベント名 | 引数 | 処理 |
|---|---|---|
| `new_todo` | `task: string` | 新しいタスクを追加。deadline は作成から +24h |
| `mark_as_done` | `id: number` | 指定 ID を todo から done へ移動 |
| `postpone` | `id: number, ms: number` | 指定 ID の deadline を `now + ms` に更新 |

### サーバー → クライアント

| イベント名 | 引数 | タイミング |
|---|---|---|
| `list_todo` | JSON 文字列 (Task[]) | 接続時・データ変更時。deadline 昇順 |
| `list_done` | JSON 文字列 (Task[]) | 接続時・データ変更時。done_at 降順、最新 3 件のみ |

---

## UI 仕様

### レイアウト

1. **タイトル**: `todolium`
2. **入力欄**: テキスト入力。Enter キーで `new_todo` を emit
3. **Recently completed**: 最近完了した 3 件を表示
4. **ToDo**: 未完了タスクを期限昇順で表示

### ToDo タスク行

```
[Done!] [+1d] [+2d] [+4d] [+8d]  <期限までの残り時間>  | タスク名
```

- 残り時間は `humanize-duration` ライブラリで `±Xd Xh` 形式に整形
- 期限切れ (負の値) は赤枠・赤背景で強調表示
- 期限内は黒枠で表示

### 完了タスク行

```
[revert]  | タスク名  完了日時ISO文字列, Took Xd Xh
```

- `revert` ボタンは現状 UI に存在するが、サーバー側のイベントハンドラは未実装

### スタイル

- フォント: Source Code Pro (等幅)
- 左ボーダーの色でステータスを区別: ToDo = オレンジ `#eecc88` / Done = 緑 `#88cc88`

---

## ビルドと実行

```bash
# ビルド + 起動
make run

# データのバックアップ (backup/todo_backup_YYYYMMDD_HHMMSS.json に保存)
make backup
```

内部的には `tsc` → `node --enable-source-maps generated/server.js` の順で実行。
サーバーはポート **3000** でリッスン。

---

## 既知の制限・未実装事項

- **revert 機能**: クライアントにボタンは存在するが、`socket.emit('revert', id)` の呼び出しとサーバー側ハンドラが未実装
- **データ永続化**: ファイル同期書き込みのため、高負荷時に競合する可能性がある
- **認証なし**: ローカル・個人利用前提。外部公開には不向き
- **複数クライアント非同期**: あるクライアントの操作が他クライアントへブロードキャストされない (`socket.emit` のみで `io.emit` を使っていない)
- **テストなし**: `package.json` の test スクリプトはプレースホルダーのみ
