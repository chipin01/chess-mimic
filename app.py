from flask import Flask, render_template, request, jsonify
import sys
import os
import json
import chess.pgn
import io
from werkzeug.utils import secure_filename

# Add current dir to path to import mimic
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from mimic import get_analysis, load_model

app = Flask(__name__)
OPPONENTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'opponents')
os.makedirs(OPPONENTS_DIR, exist_ok=True)

# Cache models in memory
models = {
    "me": load_model()
}

def get_opponent_model(name):
    if name == "me":
        return models["me"]
    
    model_path = os.path.join(OPPONENTS_DIR, f"{name}.json")
    if os.path.exists(model_path):
        with open(model_path, 'r') as f:
            return json.load(f)
    return {}

@app.route('/')
def index():
    opponents = [f.replace('.json', '') for f in os.listdir(OPPONENTS_DIR) if f.endswith('.json')]
    return render_template('index.html', opponents=opponents)

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    fen = data.get('fen')
    opponent = data.get('opponent', 'me')
    
    if not fen:
        return jsonify({"error": "No FEN provided"}), 400
    
    current_model = get_opponent_model(opponent)
    result = get_analysis(fen, current_model)
    return jsonify(result)

@app.route('/upload', methods=['POST'])
def upload_pgn():
    if 'file' not in request.files or 'name' not in request.form:
        return jsonify({"error": "Missing file or opponent name"}), 400
    
    file = request.files['file']
    opponent_name = secure_filename(request.form['name'])
    
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # Ingest logic directly in the web server for simplicity in V2
    import collections
    move_db = collections.defaultdict(collections.Counter)
    
    pgn_text = file.read().decode('utf-8')
    pgn_io = io.StringIO(pgn_text)
    
    count = 0
    while True:
        game = chess.pgn.read_game(pgn_io)
        if game is None: break
        
        white = game.headers.get("White", "")
        black = game.headers.get("Black", "")
        
        # We assume the user is uploading games where this opponent played
        # If the name matches either, we ingest their moves
        is_white = opponent_name.lower() in white.lower()
        is_black = opponent_name.lower() in black.lower()
        
        if not (is_white or is_black): continue

        board = game.board()
        for move in game.mainline_moves():
            if (board.turn == chess.WHITE and is_white) or (board.turn == chess.BLACK and is_black):
                fen_parts = board.fen().split(' ')
                fen_key = " ".join(fen_parts[:4])
                move_db[fen_key][move.uci()] += 1
            board.push(move)
        count += 1

    # Save opponent model
    model_path = os.path.join(OPPONENTS_DIR, f"{opponent_name}.json")
    serializable_db = {k: dict(v) for k, v in move_db.items()}
    with open(model_path, 'w') as f:
        json.dump(serializable_db, f)
        
    return jsonify({"success": True, "games_processed": count, "opponent": opponent_name})

if __name__ == '__main__':
    print("Starting Chess Mimic Web UI on port 5000...")
    app.run(host='0.0.0.0', port=5000)
