import os
import json
import collections
import chess.pgn

def get_fen_key(board):
    """
    Returns a unique key for the position: pieces, turn, and castling rights.
    Example: rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq
    """
    fen_parts = board.fen().split(' ')
    return " ".join(fen_parts[:4])

def ingest_pgn(file_path, target_player):
    """
    Reads a PGN and tracks stats (win/loss/draw) for the target player's moves.
    """
    # move_db[fen][move] = {"count": 0, "win": 0, "loss": 0, "draw": 0}
    move_db = collections.defaultdict(lambda: collections.defaultdict(lambda: {"count": 0, "win": 0, "loss": 0, "draw": 0}))
    
    if not os.path.exists(file_path):
        print(f"❌ Error: {file_path} not found.")
        return

    print(f"📂 Processing {file_path} for player '{target_player}'...")
    
    count = 0
    with open(file_path) as pgn:
        while True:
            game = chess.pgn.read_game(pgn)
            if game is None:
                break
            
            headers = game.headers
            white = headers.get("White", "?")
            black = headers.get("Black", "?")
            result = headers.get("Result", "*") # "1-0", "0-1", "1/2-1/2"

            is_white = target_player.lower() in white.lower()
            is_black = target_player.lower() in black.lower()
            
            if not (is_white or is_black):
                continue

            # Map the game result to the target player's perspective
            game_stat = "draw"
            if result == "1-0":
                game_stat = "win" if is_white else "loss"
            elif result == "0-1":
                game_stat = "win" if is_black else "loss"
            elif result == "1/2-1/2":
                game_stat = "draw"

            board = game.board()
            for move in game.mainline_moves():
                # Record move if it was the target player's turn
                if (board.turn == chess.WHITE and is_white) or \
                   (board.turn == chess.BLACK and is_black):
                    
                    fen_key = get_fen_key(board)
                    move_uci = move.uci()
                    
                    stats = move_db[fen_key][move_uci]
                    stats["count"] += 1
                    stats[game_stat] += 1
                
                board.push(move)
            
            count += 1
            if count % 100 == 0:
                print(f"  - Processed {count} games...")

    print(f"✅ Ingestion complete. Analyzed {count} games.")
    
    # Save to a structured JSON for the "Opening Tree" view
    output_file = "stats_model.json"
    with open(output_file, "w") as f:
        json.dump(move_db, f, indent=2)
    print(f"💾 Tree stats saved to {output_file}")

if __name__ == "__main__":
    import sys
    # Usage: python ingest.py [pgn_file] [player_name]
    if len(sys.argv) > 2:
        ingest_pgn(sys.argv[1], sys.argv[2])
    else:
        # Default for local testing
        ingest_pgn("my_games.pgn", "Chipin")
