import sqlite3
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "chess_mimic.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pgn TEXT NOT NULL,
                name TEXT,
                white TEXT,
                black TEXT,
                result TEXT,
                date TEXT,
                annotations TEXT,
                tags TEXT,
                evals TEXT,
                folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS puzzles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER,
                fen TEXT,
                best_move TEXT,
                played_move TEXT,
                score_before INTEGER,
                score_after INTEGER,
                move_number INTEGER,
                move_index INTEGER,
                turn TEXT,
                FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Migrate: add missing columns to existing games table
        cols = [row[1] for row in conn.execute("PRAGMA table_info(games)").fetchall()]
        if 'folder_id' not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL")
        if 'name' not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN name TEXT")
        if 'evals' not in cols:
            conn.execute("ALTER TABLE games ADD COLUMN evals TEXT")
        conn.commit()

def add_game(pgn, white="", black="", result="", date="", annotations="", tags="", name=None):
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO games (pgn, name, white, black, result, date, annotations, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (pgn, name, white, black, result, date, annotations, tags)
        )
        return cursor.lastrowid

def delete_game(game_id):
    with get_db() as conn:
        conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
        # Cascade delete is not enabled by default in SQLite for some versions/drivers, so manual delete for safety
        conn.execute("DELETE FROM puzzles WHERE game_id = ?", (game_id,))

def update_game(game_id, annotations=None, tags=None):
    with get_db() as conn:
        if annotations is not None:
            conn.execute("UPDATE games SET annotations = ? WHERE id = ?", (annotations, game_id))
        if tags is not None:
            conn.execute("UPDATE games SET tags = ? WHERE id = ?", (tags, game_id))

def add_puzzle(game_id, fen, best_move, played_move, score_before, score_after, move_number, move_index, turn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO puzzles (game_id, fen, best_move, played_move, score_before, score_after, move_number, move_index, turn) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (game_id, fen, best_move, played_move, score_before, score_after, move_number, move_index, turn)
        )

def get_puzzles(game_id):
    with get_db() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM puzzles WHERE game_id = ?", (game_id,)).fetchall()]

def get_all_games():
    with get_db() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM games").fetchall()]

# --- Folder functions ---

def create_folder(name):
    with get_db() as conn:
        cursor = conn.execute("INSERT INTO folders (name) VALUES (?)", (name,))
        return cursor.lastrowid

def get_all_folders():
    with get_db() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM folders ORDER BY name").fetchall()]

def rename_folder(folder_id, name):
    with get_db() as conn:
        conn.execute("UPDATE folders SET name = ? WHERE id = ?", (name, folder_id))

def delete_folder(folder_id, delete_games=False):
    with get_db() as conn:
        if delete_games:
            # Delete all puzzles for games in this folder, then the games
            game_ids = [r['id'] for r in conn.execute("SELECT id FROM games WHERE folder_id = ?", (folder_id,)).fetchall()]
            for gid in game_ids:
                conn.execute("DELETE FROM puzzles WHERE game_id = ?", (gid,))
                conn.execute("DELETE FROM games WHERE id = ?", (gid,))
        else:
            # Move games back to unfiled
            conn.execute("UPDATE games SET folder_id = NULL WHERE folder_id = ?", (folder_id,))
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))

def move_game_to_folder(game_id, folder_id):
    with get_db() as conn:
        conn.execute("UPDATE games SET folder_id = ? WHERE id = ?", (folder_id, game_id))

def get_folder_stats():
    """Returns {folder_id: {game_count, puzzle_count}} including None for unfiled."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT g.folder_id,
                   COUNT(DISTINCT g.id) as game_count,
                   COUNT(p.id) as puzzle_count
            FROM games g
            LEFT JOIN puzzles p ON p.game_id = g.id
            GROUP BY g.folder_id
        """).fetchall()
        return {row['folder_id']: {'game_count': row['game_count'], 'puzzle_count': row['puzzle_count']} for row in rows}

if __name__ == "__main__":
    init_db()
    print("✅ Database initialized.")
