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
                white TEXT,
                black TEXT,
                result TEXT,
                date TEXT,
                annotations TEXT,
                tags TEXT
            )
        """)
        conn.commit()

def add_game(pgn, white="", black="", result="", date="", annotations="", tags=""):
    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO games (pgn, white, black, result, date, annotations, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (pgn, white, black, result, date, annotations, tags)
        )
        return cursor.lastrowid

def delete_game(game_id):
    with get_db() as conn:
        conn.execute("DELETE FROM games WHERE id = ?", (game_id,))

def update_game(game_id, annotations=None, tags=None):
    with get_db() as conn:
        if annotations is not None:
            conn.execute("UPDATE games SET annotations = ? WHERE id = ?", (annotations, game_id))
        if tags is not None:
            conn.execute("UPDATE games SET tags = ? WHERE id = ?", (tags, game_id))

def get_all_games():
    with get_db() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM games").fetchall()]

if __name__ == "__main__":
    init_db()
    print("✅ Database initialized.")
