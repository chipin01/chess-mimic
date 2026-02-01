import chess.pgn
import os
import collections

# A simple structure to hold move frequencies for positions
# Key: FEN (Board State) -> Value: Counter({Move: Count})
move_db = collections.defaultdict(collections.Counter)

def ingest_pgn(file_path, target_player):
    """
    Reads a PGN file and learns moves made by target_player.
    """
    print(f"📂 Reading {file_path} for player '{target_player}'...")
    
    count = 0
    with open(file_path) as pgn:
        while True:
            game = chess.pgn.read_game(pgn)
            if game is None:
                break
            
            # Check if target player is in this game
            white = game.headers.get("White", "?")
            black = game.headers.get("Black", "?")
            
            is_white = target_player.lower() in white.lower()
            is_black = target_player.lower() in black.lower()
            
            if not (is_white or is_black):
                continue

            # Replay the game
            board = game.board()
            for move in game.mainline_moves():
                # If it's the target player's turn, record the move
                if (board.turn == chess.WHITE and is_white) or \
                   (board.turn == chess.BLACK and is_black):
                    
                    # Store by FEN (excluding move clocks)
                    # Key: "pieces color castling ep"
                    # Example: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -
                    fen_parts = board.fen().split(' ')
                    fen_key = " ".join(fen_parts[:4])
                    
                    move_db[fen_key][move.uci()] += 1
                
                board.push(move)
            
            count += 1
            if count % 100 == 0:
                print(f"  - Processed {count} games...")

    print(f"✅ Ingestion complete. Learned from {count} games.")
    
    # Save to JSON
    import json
    with open("model.json", "w") as f:
        # Convert Counter to dict for JSON serialization
        # move_db is defaultdict(Counter)
        serializable_db = {k: dict(v) for k, v in move_db.items()}
        json.dump(serializable_db, f)
    print("💾 Model saved to model.json")

if __name__ == "__main__":
    # Ingest games for the specified user
    # Use absolute path or ensure we are in the right dir
    base_dir = os.path.dirname(os.path.abspath(__file__))
    pgn_file = os.path.join(base_dir, "my_games.pgn")
    user = "e4_c5_c3-1-0"
    
    if os.path.exists(pgn_file):
        ingest_pgn(pgn_file, user)
    else:
        print(f"No {pgn_file} found. Please download it first.")
