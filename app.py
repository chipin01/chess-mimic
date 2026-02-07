import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

from flask import Flask, render_template, request, jsonify
import database
import ingest
import chess.pgn
import io

app = Flask(__name__)
database.init_db()

# Force reload
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_pgn():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    content = file.read().decode('utf-8')
    pgn_io = io.StringIO(content)
    
    games_added = 0
    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break
        
        h = game.headers
        chapter_name = h.get("ChapterName", "")
        white = h.get("White", "Unknown")
        black = h.get("Black", "Unknown")

        is_white_generic = white.lower() in ["unknown", "?", ""]
        is_black_generic = black.lower() in ["unknown", "?", ""]

        if (is_white_generic or is_black_generic) and chapter_name:
            try:
                parts = chapter_name.split("/")
                if len(parts) == 2:
                    import re
                    score_pattern = r'\s*\([\d\/\.\-]+\)\s*'
                    white_parsed = re.sub(score_pattern, '', parts[0]).strip()
                    black_parsed = re.sub(score_pattern, '', parts[1]).strip()
                    
                    if is_white_generic: white = white_parsed
                    if is_black_generic: black = black_parsed
            except: pass

        database.add_game(
            pgn=str(game),
            white=white,
            black=black,
            result=h.get("Result", "*"),
            date=h.get("Date", "????.??.??")
        )
        games_added += 1

    return jsonify({"success": True, "count": games_added})

@app.route('/tree')
def get_tree():
    player_name = request.args.get('player', '')
    games = database.get_all_games()
    move_db = {} 
    for g in games:
        pgn_io = io.StringIO(g['pgn'])
        game = chess.pgn.read_game(pgn_io)
        if not game: continue
        white = game.headers.get("White", "")
        black = game.headers.get("Black", "")
        res = game.headers.get("Result", "*")
        is_white = player_name.lower() in white.lower()
        is_black = player_name.lower() in black.lower()
        if player_name and not (is_white or is_black): continue
        stat = "draw"
        if res == "1-0": stat = "win" if is_white else "loss"
        elif res == "0-1": stat = "win" if is_black else "loss"
        board = game.board()
        for move in game.mainline_moves():
            if not player_name or (board.turn == chess.WHITE and is_white) or (board.turn == chess.BLACK and is_black):
                fen = ingest.get_fen_key(board)
                move_uci = move.uci()
                if fen not in move_db: move_db[fen] = {}
                if move_uci not in move_db[fen]:
                    move_db[fen][move_uci] = {"count": 0, "win": 0, "loss": 0, "draw": 0}
                m = move_db[fen][move_uci]
                m["count"] += 1
                m[stat] += 1
            board.push(move)
    return jsonify(move_db)

@app.route('/games', methods=['GET'])
def list_games():
    return jsonify(database.get_all_games())

@app.route('/games/<int:game_id>', methods=['GET'])
def get_game(game_id):
    games = database.get_all_games()
    game = next((g for g in games if g['id'] == game_id), None)
    if not game: return jsonify({"error": "No game"}), 404
    
    pgn_io = io.StringIO(game['pgn'])
    parsed_game = chess.pgn.read_game(pgn_io)
    moves = []
    board = parsed_game.board()
    
    import json
    db_annotations = {}
    if game.get('annotations'):
        try: db_annotations = json.loads(game['annotations'])
        except: pass

    # FIXED LOGIC: Store FEN AFTER move is pushed
    for move in parsed_game.mainline_moves():
        san = board.san(move)
        board.push(move)
        fen_after = board.fen()
        moves.append({
            "san": san,
            "fen": fen_after,
            "comment": db_annotations.get(fen_after, "")
        })
        
    return jsonify({
        "id": game['id'], "white": game['white'], "black": game['black'],
        "date": game['date'], "result": game['result'], "moves": moves,
        "initial_fen": parsed_game.board().fen()
    })

@app.route('/games/<int:game_id>', methods=['DELETE'])
def remove_game(game_id):
    database.delete_game(game_id)
    return jsonify({"success": True})

@app.route('/games/<int:game_id>/annotate', methods=['POST'])
def annotate_move(game_id):
    data = request.json
    fen, comment = data.get('fen'), data.get('comment')
    games = database.get_all_games()
    game = next((g for g in games if g['id'] == game_id), None)
    if not game: return jsonify({"error": "No game"}), 404
    import json
    annotations = {}
    if game.get('annotations'):
        try: annotations = json.loads(game['annotations'])
        except: pass
    annotations[fen] = comment
    database.update_game(game_id, annotations=json.dumps(annotations))
    return jsonify({"success": True})

@app.route('/games/<int:game_id>/puzzles', methods=['GET'])
def get_game_puzzles(game_id):
    games = database.get_all_games()
    game = next((g for g in games if g['id'] == game_id), None)
    if not game: return jsonify({"error": "No game"}), 404
    pgn_io = io.StringIO(game['pgn'])
    parsed_game = chess.pgn.read_game(pgn_io)
    board = parsed_game.board()
    engine_path = os.path.join(BASE_DIR, "engines", "stockfish")
    puzzles = []
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        prev_eval = 0
        for i, move in enumerate(parsed_game.mainline_moves()):
            fen_before = board.fen()
            info = engine.analyse(board, chess.engine.Limit(time=0.1))
            best_move = info["pv"][0]
            score = info["score"].white()
            current_eval = score.score() if score.score() is not None else (10000 if score.mate() > 0 else -10000)
            if i > 0:
                eval_diff = abs(current_eval - prev_eval)
                if eval_diff > 150:
                    puzzles.append({"fen": fen_before, "best_move": best_move.uci(), "score_before": prev_eval, "score_after": current_eval, "move_number": (i // 2) + 1, "turn": "white" if board.turn == chess.WHITE else "black"})
            prev_eval = current_eval
            board.push(move)
    return jsonify(puzzles)

@app.route('/analyze')
def analyze_fen():
    fen = request.args.get('fen', chess.STARTING_FEN)
    engine_path = os.path.join(BASE_DIR, "engines", "stockfish")
    if not os.path.exists(engine_path): return jsonify({"error": "No engine"}), 404
    board = chess.Board(fen)
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        results = engine.analyse(board, chess.engine.Limit(time=0.1), multipv=3)
        analysis_data = []
        for res in results:
            score = res["score"].white()
            score_val = score.score() if score.score() is not None else (10000 if score.mate() > 0 else -10000)
            analysis_data.append({"best_move": res["pv"][0].uci(), "score": score_val, "pv": [m.uci() for m in res["pv"][:5]]})
        return jsonify(analysis_data)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
