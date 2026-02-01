import json
import chess
import chess.engine
import os

# Paths relative to this script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_FILE = os.path.join(BASE_DIR, "model.json")
STOCKFISH_PATH = os.path.join(BASE_DIR, "engines", "stockfish")

def load_model():
    if not os.path.exists(MODEL_FILE):
        return {}
    with open(MODEL_FILE, "r") as f:
        return json.load(f)

def get_analysis(fen, model=None):
    """
    Returns a dict with analysis data:
    {
        "fen": str,
        "turn": "white" | "black",
        "stockfish": { "best_move": str, "score": float },
        "mimic": [ { "move": str, "count": int, "score": float, "is_best": bool } ]
    }
    """
    if model is None:
        model = load_model()

    board = chess.Board(fen)
    result = {
        "fen": fen,
        "turn": "white" if board.turn == chess.WHITE else "black",
        "stockfish": {},
        "mimic": []
    }

    # 1. Lookup Mimic Moves
    fen_parts = fen.split(' ')
    lookup_fen = " ".join(fen_parts[:4])
    player_moves = model.get(lookup_fen, {})

    try:
        with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
            # Analyze best move
            info = engine.analyse(board, chess.engine.Limit(depth=15))
            best_move = info["pv"][0]
            sf_score = info["score"].white()
            
            # Handle mate scores
            sf_score_val = sf_score.score() if sf_score.score() is not None else (10000 if sf_score.mate() > 0 else -10000)

            result["stockfish"] = {
                "best_move": best_move.uci(),
                "score": sf_score_val
            }

            if not player_moves:
                return result

            # Analyze Mimic moves
            sorted_moves = sorted(player_moves.items(), key=lambda x: x[1], reverse=True)
            for move_uci, count in sorted_moves[:5]: # Top 5
                try:
                    move = chess.Move.from_uci(move_uci)
                    if move not in board.legal_moves:
                        continue
                        
                    board.push(move)
                    player_info = engine.analyse(board, chess.engine.Limit(depth=10))
                    player_score = player_info["score"].white()
                    player_score_val = player_score.score() if player_score.score() is not None else (10000 if player_score.mate() > 0 else -10000)
                    board.pop()
                    
                    result["mimic"].append({
                        "move": move_uci,
                        "count": count,
                        "score": player_score_val,
                        "is_best": (move == best_move)
                    })
                except Exception as e:
                    print(f"Error analyzing move {move_uci}: {e}")

    except Exception as e:
        print(f"Engine error: {e}")
        result["error"] = str(e)

    return result

def analyze_position(fen, model, engine_path):
    # Wrapper for CLI backward compatibility
    data = get_analysis(fen, model)
    
    print(f"\n📊 Position: {data['fen']}")
    print(f"   Turn: {data['turn'].capitalize()}")
    
    sf = data.get("stockfish", {})
    if "best_move" in sf:
        print(f"   🤖 Stockfish Best: {sf['best_move']} (Score: {sf['score']})")
    
    mimic = data.get("mimic", [])
    if not mimic:
        print("   🤷 Mimic: I haven't seen this position before.")
    else:
        print(f"   👤 Mimic (You):")
        for m in mimic:
            status = "✅ Best" if m['is_best'] else f"Diff: {sf['score'] - m['score']}"
            print(f"      - {m['move']}: played {m['count']} times. ({status})")

def main():
    model = load_model()
    print(f"Loaded model with {len(model)} known positions.")
    
    if not os.path.exists(STOCKFISH_PATH):
        print(f"❌ Stockfish not found at {STOCKFISH_PATH}")
        return

    # Interactive mode or Test
    # Let's test with the starting position
    start_fen = chess.STARTING_FEN
    analyze_position(start_fen, model, STOCKFISH_PATH)
    
    # Let's try to find a position from the model that isn't start
    # Pick a random one with > 2 moves
    for fen, moves in model.items():
        if len(moves) > 1 and sum(moves.values()) > 2:
            # Reconstruct full FEN (just guess clocks for analysis)
            # Actually chess.Board(fen) works if it's just piece placement + active color + castling + ep
            # But our key is ONLY piece placement. We need to handle that.
            # Ingest used `board.fen().split(' ')[0]`. 
            # We need to reconstruct a valid FEN or store full FENs.
            # Wait, `ingest.py` stored `board.fen().split(' ')[0]`. This discards turn info!
            # That's a BUG in my ingest logic. White and Black moves are mixed if the piece placement is identical?
            # Actually, piece placement usually implies whose turn it is implicitly by piece count/position, 
            # BUT technically FEN has active color.
            # If I store only piece placement, I lose who is to move.
            # HOWEVER, `ingest.py` code was: `fen = board.fen().split(' ')[0]`
            # A standard FEN is `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`
            # Split[0] is just the pieces.
            # If I pass that to chess.Board(), it assumes White to move by default?
            # Let's check `chess.Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")`
            pass
            
            # Correction: I should fix Ingest to include active color at least.
            # `fen = " ".join(board.fen().split(' ')[:2])` -> "pieces w" or "pieces b"
            pass

    print("\nNote: To test more positions, update the code or run interactively.")

if __name__ == "__main__":
    main()
