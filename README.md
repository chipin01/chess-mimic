# Chess Mimic ♟️

A specialized engine that learns to play like specific humans by analyzing their PGN game history.

## Goals
1. **Ingest PGNs:** Parse bulk game files for a specific player.
2. **Learn Style:** Build a probability model of their moves in given positions.
3. **Evaluate:** Use Stockfish to analyze the quality of their typical moves vs. optimal moves.
4. **Predict:** Given a board state, predict "What would [Player] do?" (even if it's a blunder).

## Setup
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Download Stockfish (Linux x86-64) and place it in `engines/stockfish`.

## Usage
*Coming soon...*

### Lichess Token
You will need a Lichess token to access the Lichess API. You can get one by creating an account on [Lichess](https://lichess.org).
mine is (`your_lichess_token_here`)

### 

