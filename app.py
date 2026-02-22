import sys
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

from flask import Flask, render_template, request, jsonify, Response
import database
import ingest
import positional_engine
import chess.pgn
import io
import time
import json as json_module
import requests as http_requests
import re

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
        
    # Parse saved evals
    saved_evals = []
    if game.get('evals'):
        try: saved_evals = json_module.loads(game['evals'])
        except: pass

    return jsonify({
        "id": game['id'], "white": game['white'], "black": game['black'],
        "date": game['date'], "result": game['result'], "moves": moves,
        "initial_fen": parsed_game.board().fen(),
        "evals": saved_evals
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
    puzzles = database.get_puzzles(game_id)
    return jsonify(puzzles)

@app.route('/games/<int:game_id>/scan', methods=['POST'])
def scan_game_puzzles(game_id):
    games = database.get_all_games()
    game = next((g for g in games if g['id'] == game_id), None)
    if not game: return jsonify({"error": "No game"}), 404
    
    # Clear existing puzzles for this game to avoid duplicates on re-scan
    with database.get_db() as conn:
        conn.execute("DELETE FROM puzzles WHERE game_id = ?", (game_id,))

    pgn_io = io.StringIO(game['pgn'])
    parsed_game = chess.pgn.read_game(pgn_io)
    board = parsed_game.board()
    engine_path = os.path.join(BASE_DIR, "engines", "stockfish")
    puzzles_found = 0
    
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        prev_eval = 0
        prev_fen = None
        prev_best_move = None
        prev_move = None
        
        for i, move in enumerate(parsed_game.mainline_moves()):
            current_fen = board.fen()
            info = engine.analyse(board, chess.engine.Limit(time=0.1))
            current_best_move = info["pv"][0]
            
            score = info["score"].white()
            current_eval = score.score() if score.score() is not None else (10000 if score.mate() > 0 else -10000)
            
            if i > 0:
                eval_diff = abs(current_eval - prev_eval)
                if eval_diff > 100:
                    database.add_puzzle(
                        game_id=game_id,
                        fen=prev_fen,
                        best_move=prev_best_move.uci(),
                        played_move=prev_move.uci(),
                        score_before=prev_eval,
                        score_after=current_eval,
                        move_number=((i - 1) // 2) + 1,
                        move_index=i - 1,
                        turn="white" if (i - 1) % 2 == 0 else "black"
                    )
                    puzzles_found += 1
            
            prev_eval = current_eval
            prev_fen = current_fen
            prev_best_move = current_best_move
            prev_move = move
            board.push(move)
            
    return jsonify({"success": True, "count": puzzles_found})

@app.route('/games/<int:game_id>/scan-chunked', methods=['POST'])
def scan_game_chunked(game_id):
    games = database.get_all_games()
    game = next((g for g in games if g['id'] == game_id), None)
    if not game:
        return jsonify({"error": "No game"}), 404

    body = request.get_json(silent=True) or {}
    chunk_size = body.get('chunk_size', 10)
    delay_ms = body.get('delay_ms', 500)
    threshold = body.get('threshold', 100)

    # Clear existing puzzles
    with database.get_db() as conn:
        conn.execute("DELETE FROM puzzles WHERE game_id = ?", (game_id,))

    pgn_io = io.StringIO(game['pgn'])
    parsed_game = chess.pgn.read_game(pgn_io)
    all_moves = list(parsed_game.mainline_moves())
    total_moves = len(all_moves)

    def generate():
        board = parsed_game.board()
        engine_path = os.path.join(BASE_DIR, "engines", "stockfish")
        puzzles_found = 0
        all_evals = []

        with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
            prev_eval = 0
            prev_fen = None
            prev_best_move = None
            prev_move = None

            for chunk_start in range(0, total_moves, chunk_size):
                chunk_end = min(chunk_start + chunk_size, total_moves)

                for i in range(chunk_start, chunk_end):
                    move = all_moves[i]
                    current_fen = board.fen()
                    info = engine.analyse(board, chess.engine.Limit(time=0.1))
                    current_best_move = info["pv"][0]

                    score = info["score"].white()
                    current_eval = score.score() if score.score() is not None else (10000 if score.mate() > 0 else -10000)

                    if i > 0:
                        eval_diff = abs(current_eval - prev_eval)
                        if eval_diff > threshold:
                            database.add_puzzle(
                                game_id=game_id,
                                fen=prev_fen,
                                best_move=prev_best_move.uci(),
                                played_move=prev_move.uci(),
                                score_before=prev_eval,
                                score_after=current_eval,
                                move_number=((i - 1) // 2) + 1,
                                move_index=i - 1,
                                turn="white" if (i - 1) % 2 == 0 else "black"
                            )
                            puzzles_found += 1

                    prev_eval = current_eval
                    all_evals.append(current_eval)
                    prev_fen = current_fen
                    prev_best_move = current_best_move
                    prev_move = move
                    board.push(move)

                # Emit progress after each chunk
                event_data = json_module.dumps({
                    "progress": chunk_end,
                    "total": total_moves,
                    "puzzles_so_far": puzzles_found,
                    "evals": all_evals
                })
                yield f"data: {event_data}\n\n"

                # Delay between chunks (skip on last chunk)
                if chunk_end < total_moves:
                    time.sleep(delay_ms / 1000.0)

        # Save evals to database
        with database.get_db() as conn:
            conn.execute("UPDATE games SET evals = ? WHERE id = ?",
                         (json_module.dumps(all_evals), game_id))

        # Final done event
        done_data = json_module.dumps({
            "done": True,
            "progress": total_moves,
            "total": total_moves,
            "total_puzzles": puzzles_found,
            "evals": all_evals
        })
        yield f"data: {done_data}\n\n"

    return Response(generate(), mimetype='text/event-stream')

# --- Folder endpoints ---

@app.route('/folders', methods=['GET'])
def list_folders():
    folders = database.get_all_folders()
    stats = database.get_folder_stats()
    for f in folders:
        s = stats.get(f['id'], {'game_count': 0, 'puzzle_count': 0})
        f['game_count'] = s['game_count']
        f['puzzle_count'] = s['puzzle_count']
    # Include unfiled stats
    unfiled = stats.get(None, {'game_count': 0, 'puzzle_count': 0})
    return jsonify({'folders': folders, 'unfiled': unfiled})

@app.route('/folders', methods=['POST'])
def create_folder():
    data = request.json
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    folder_id = database.create_folder(name)
    return jsonify({"success": True, "id": folder_id})

@app.route('/folders/<int:folder_id>', methods=['PUT'])
def rename_folder(folder_id):
    data = request.json
    name = data.get('name', '').strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    database.rename_folder(folder_id, name)
    return jsonify({"success": True})

@app.route('/folders/<int:folder_id>', methods=['DELETE'])
def delete_folder(folder_id):
    delete_games = request.args.get('delete_games', 'false').lower() == 'true'
    database.delete_folder(folder_id, delete_games=delete_games)
    return jsonify({"success": True})

@app.route('/games/<int:game_id>/move', methods=['PUT'])
def move_game(game_id):
    data = request.json
    folder_id = data.get('folder_id')  # None = unfiled
    database.move_game_to_folder(game_id, folder_id)
    return jsonify({"success": True})

@app.route('/analyze')
def analyze_fen():
    fen = request.args.get('fen', chess.STARTING_FEN)
    
    # 1. Engine Analysis (Tactical)
    engine_path = os.path.join(BASE_DIR, "engines", "stockfish")
    if not os.path.exists(engine_path): return jsonify({"error": "No engine"}), 404
    
    board = chess.Board(fen)
    tactical_data = []
    with chess.engine.SimpleEngine.popen_uci(engine_path) as engine:
        results = engine.analyse(board, chess.engine.Limit(time=0.1), multipv=3)
        for res in results:
            score = res["score"].white()
            score_val = score.score() if score.score() is not None else (10000 if score.mate() > 0 else -10000)
            tactical_data.append({
                "best_move": res["pv"][0].uci(), 
                "score": score_val, 
                "pv": [m.uci() for m in res["pv"][:5]]
            })
            
    # 2. Positional Analysis
    positional_data = positional_engine.analyze_positional_features(fen)
    
    return jsonify({
        "tactical": tactical_data,
        "positional": positional_data
    })

# --- Lichess Import ---

LICHESS_API = 'https://lichess.org'

@app.route('/lichess/studies')
def lichess_studies():
    username = request.args.get('username', '').strip()
    if not username:
        return jsonify({"error": "Username required"}), 400

    headers = {'Accept': 'application/x-ndjson'}
    token = request.headers.get('X-Lichess-Token')
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        resp = http_requests.get(
            f'{LICHESS_API}/api/study/by/{username}',
            headers=headers,
            timeout=15,
            stream=True
        )
        if resp.status_code == 404:
            return jsonify({"error": "User not found"}), 404
        if resp.status_code == 401:
            return jsonify({"error": "Invalid token"}), 401
        resp.raise_for_status()

        studies = []
        for line in resp.iter_lines(decode_unicode=True):
            if line.strip():
                study = json_module.loads(line)
                # chapters can be an array of IDs or a count
                ch = study.get('chapters', [])
                ch_count = len(ch) if isinstance(ch, list) else (ch if isinstance(ch, int) else 0)
                studies.append({
                    'id': study.get('id'),
                    'name': study.get('name', 'Untitled'),
                    'chapters': ch_count,
                    'createdAt': study.get('createdAt'),
                    'updatedAt': study.get('updatedAt'),
                })
        return jsonify(studies)
    except http_requests.RequestException as e:
        return jsonify({"error": str(e)}), 502


def parse_players_from_event(event_name):
    """Parse 'player1 (1) / player2 (0)' pattern from end of an event name.
    Returns (white, black, result) or (None, None, None) if no match."""
    # Match patterns like: Name (1) / Name (0), Name (½) / Name (½), Name (1/2) / Name (1/2)
    m = re.search(r'(.+?)\s*\((1|0|½|0\.5|1\.0|0\.0|1/2)\)\s*(?:/|vs)\s*(.+?)\s*\((1|0|½|0\.5|1\.0|0\.0|1/2)\)\s*$', event_name)
    if not m:
        return None, None, None
    white = m.group(1).strip()
    w_score = m.group(2)
    black = m.group(3).strip()
    b_score = m.group(4)
    # Convert scores to result
    score_map = {'1': 1.0, '1.0': 1.0, '0': 0.0, '0.0': 0.0, '½': 0.5, '0.5': 0.5, '1/2': 0.5}
    ws = score_map.get(w_score, 0)
    bs = score_map.get(b_score, 0)
    if ws > bs:
        result = '1-0'
    elif bs > ws:
        result = '0-1'
    else:
        result = '1/2-1/2'
    return white, black, result


@app.route('/lichess/import', methods=['POST'])
def lichess_import():
    data = request.json
    study_id = data.get('study_id', '').strip()
    study_name = data.get('study_name', 'Lichess Study')
    study_date = data.get('study_date', '')
    if not study_id:
        return jsonify({"error": "study_id required"}), 400

    headers = {}
    token = request.headers.get('X-Lichess-Token')
    if token:
        headers['Authorization'] = f'Bearer {token}'

    try:
        resp = http_requests.get(
            f'{LICHESS_API}/api/study/{study_id}.pgn',
            headers=headers,
            timeout=30
        )
        if resp.status_code == 404:
            return jsonify({"error": "Study not found"}), 404
        if resp.status_code == 401:
            return jsonify({"error": "Unauthorized — check your token"}), 401
        resp.raise_for_status()
    except http_requests.RequestException as e:
        return jsonify({"error": str(e)}), 502

    pgn_text = resp.text
    if not pgn_text.strip():
        return jsonify({"error": "Study is empty"}), 400

    # Create a folder for this study
    folder_id = database.create_folder(study_name)

    # Parse each game (chapter) from the PGN
    pgn_io = io.StringIO(pgn_text)
    imported = 0
    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None:
            break
        game_pgn = str(game)
        headers_dict = dict(game.headers)
        event_name = headers_dict.get('Event', '?')

        # Lichess study PGN Event header format: "Study Name: Chapter Name"
        # Extract the chapter name (everything after the first colon)
        if ':' in event_name:
            chapter_name = event_name.split(':', 1)[1].strip()
        else:
            chapter_name = event_name if event_name not in ('?', '') else None

        # Try to parse players and result from the chapter name
        # Pattern: "... player1 (1) / player2 (0)" or "... player1 (1) vs player2 (0)"
        parsed_w, parsed_b, parsed_result = parse_players_from_event(chapter_name or '')

        # If parsed from chapter name, use those; otherwise fall back to PGN White/Black
        if parsed_w and parsed_b:
            white = parsed_w
            black = parsed_b
            result = parsed_result or headers_dict.get('Result', '*')
        else:
            white = headers_dict.get('White', '?')
            black = headers_dict.get('Black', '?')
            result = headers_dict.get('Result', '*')
            # If White/Black are still '?', try to parse the chapter name differently
            if white == '?' and black == '?' and chapter_name:
                # Maybe the chapter name is just "player1 vs player2" without scores
                vs_match = re.match(r'^(.+?)\s+(?:vs\.?|–|-)\s+(.+)$', chapter_name)
                if vs_match:
                    white = vs_match.group(1).strip()
                    black = vs_match.group(2).strip()

        # Use study date if the game has no meaningful date
        game_date = headers_dict.get('Date', '')
        if not game_date or game_date.startswith('???'):
            game_date = study_date

        game_id = database.add_game(
            pgn=game_pgn,
            name=chapter_name,
            white=white,
            black=black,
            result=result,
            date=game_date,
        )
        database.move_game_to_folder(game_id, folder_id)
        imported += 1

    return jsonify({"success": True, "imported": imported, "folder_id": folder_id})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
