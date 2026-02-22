import chess

def get_bad_bishops(board):
    """
    Identifies 'bad' bishops that are restricted by their own pawns on the same color squares.
    """
    findings = []
    for square in board.pieces(chess.BISHOP, board.turn):
        is_light = chess.BB_SQUARES[square] & chess.BB_LIGHT_SQUARES
        own_pawns = board.pieces(chess.PAWN, board.turn)
        
        # Count pawns on the same color as the bishop
        restricted_count = 0
        for p_sq in own_pawns:
            p_is_light = chess.BB_SQUARES[p_sq] & chess.BB_LIGHT_SQUARES
            if bool(is_light) == bool(p_is_light):
                restricted_count += 1
        
        if restricted_count >= 4:
            findings.append({
                "type": "Bad Bishop",
                "square": chess.square_name(square),
                "severity": "High" if restricted_count >= 6 else "Medium",
                "description": f"The bishop on {chess.square_name(square)} is restricted by {restricted_count} pawns on the same color."
            })
    return findings

def get_isolated_pawns(board):
    """
    Identifies pawns that have no friendly pawns on adjacent files.
    """
    findings = []
    own_pawns = board.pieces(chess.PAWN, board.turn)
    
    for square in own_pawns:
        file = chess.square_file(square)
        adjacent_files = []
        if file > 0: adjacent_files.append(file - 1)
        if file < 7: adjacent_files.append(file + 1)
        
        is_isolated = True
        for adj_file in adjacent_files:
            # Check if any friendly pawn exists on the adjacent file
            if any(chess.square_file(p_sq) == adj_file for p_sq in own_pawns):
                is_isolated = False
                break
        
        if is_isolated:
            findings.append({
                "type": "Isolated Pawn",
                "square": chess.square_name(square),
                "severity": "Medium",
                "description": f"The pawn on {chess.square_name(square)} is isolated and may become a target."
            })
    return findings

def get_open_files(board):
    """
    Identifies rooks on open or semi-open files.
    """
    findings = []
    own_rooks = board.pieces(chess.ROOK, board.turn)
    
    for square in own_rooks:
        file = chess.square_file(square)
        
        # Check for pawns on this file
        white_pawns = board.pieces(chess.PAWN, chess.WHITE)
        black_pawns = board.pieces(chess.PAWN, chess.BLACK)
        
        wp_on_file = any(chess.square_file(p_sq) == file for p_sq in white_pawns)
        bp_on_file = any(chess.square_file(p_sq) == file for p_sq in black_pawns)
        
        if not wp_on_file and not bp_on_file:
            findings.append({
                "type": "Open File",
                "square": chess.square_name(square),
                "severity": "Good",
                "description": f"The rook on {chess.square_name(square)} is well-placed on an open file."
            })
        elif (board.turn == chess.WHITE and not wp_on_file) or (board.turn == chess.BLACK and not bp_on_file):
            findings.append({
                "type": "Semi-Open File",
                "square": chess.square_name(square),
                "severity": "Good",
                "description": f"The rook on {chess.square_name(square)} is on a semi-open file."
            })
            
    return findings

def get_king_safety(board):
    """
    Detects weak color complexes around the king.
    A weak color complex exists when the bishop matching the dominant color
    of squares around the king has been lost.
    """
    findings = []
    king_sq = board.king(board.turn)
    if king_sq is None:
        return findings

    king_rank = chess.square_rank(king_sq)
    king_file = chess.square_file(king_sq)

    # Gather adjacent squares
    adjacent_squares = []
    for dr in [-1, 0, 1]:
        for df in [-1, 0, 1]:
            if dr == 0 and df == 0:
                continue
            r, f = king_rank + dr, king_file + df
            if 0 <= r <= 7 and 0 <= f <= 7:
                adjacent_squares.append(chess.square(f, r))

    # Count light vs dark among adjacent squares
    light_count = sum(1 for sq in adjacent_squares if chess.BB_SQUARES[sq] & chess.BB_LIGHT_SQUARES)
    dark_count = len(adjacent_squares) - light_count

    # Determine the dominant color
    dominant_is_light = light_count >= dark_count
    dominant_count = max(light_count, dark_count)

    # Check if the friendly bishop on the dominant color exists
    has_matching_bishop = False
    for bsq in board.pieces(chess.BISHOP, board.turn):
        bishop_is_light = bool(chess.BB_SQUARES[bsq] & chess.BB_LIGHT_SQUARES)
        if bishop_is_light == dominant_is_light:
            has_matching_bishop = True
            break

    if not has_matching_bishop and dominant_count >= 3:
        color_name = "light" if dominant_is_light else "dark"
        severity = "High" if dominant_count >= 5 else "Medium"
        findings.append({
            "type": "Weak Color Complex",
            "square": chess.square_name(king_sq),
            "severity": severity,
            "description": (
                f"The king on {chess.square_name(king_sq)} is surrounded by "
                f"{dominant_count} {color_name} squares and the {color_name}-squared "
                f"bishop is missing — these squares are permanently weak."
            )
        })

    return findings


def get_knight_outposts(board):
    """
    Identifies knight outposts: knights on advanced ranks (4-6 for White,
    3-5 for Black) that cannot be challenged by enemy pawns on adjacent files.
    """
    findings = []
    enemy_color = not board.turn
    enemy_pawns = board.pieces(chess.PAWN, enemy_color)
    own_pawns = board.pieces(chess.PAWN, board.turn)

    for sq in board.pieces(chess.KNIGHT, board.turn):
        rank = chess.square_rank(sq)
        file = chess.square_file(sq)

        # Advanced rank check (ranks 4-6 for White = indices 3-5, mirrored for Black)
        if board.turn == chess.WHITE:
            if rank < 3 or rank > 5:
                continue
        else:
            if rank < 2 or rank > 4:
                continue

        # Check if any enemy pawn on adjacent files can advance to challenge
        can_be_challenged = False
        adj_files = [f for f in [file - 1, file + 1] if 0 <= f <= 7]

        for p_sq in enemy_pawns:
            p_file = chess.square_file(p_sq)
            if p_file not in adj_files:
                continue
            p_rank = chess.square_rank(p_sq)
            # Enemy pawn must be behind the knight (able to advance toward it)
            if enemy_color == chess.WHITE:
                # White enemy pawns advance up (increasing rank)
                if p_rank < rank:
                    can_be_challenged = True
                    break
            else:
                # Black enemy pawns advance down (decreasing rank)
                if p_rank > rank:
                    can_be_challenged = True
                    break

        if can_be_challenged:
            continue

        # Check if supported by a friendly pawn
        supported = False
        for p_sq in own_pawns:
            p_file = chess.square_file(p_sq)
            p_rank = chess.square_rank(p_sq)
            if p_file in adj_files:
                if board.turn == chess.WHITE and p_rank == rank - 1:
                    supported = True
                    break
                elif board.turn == chess.BLACK and p_rank == rank + 1:
                    supported = True
                    break

        severity = "Good" if supported else "Medium"
        support_str = "supported by a pawn" if supported else "unsupported"
        findings.append({
            "type": "Knight Outpost",
            "square": chess.square_name(sq),
            "severity": severity,
            "description": (
                f"The knight on {chess.square_name(sq)} is a strong outpost "
                f"({support_str}) — no enemy pawn can challenge it."
            )
        })

    return findings


def analyze_positional_features(fen):
    """
    Main entry point for the positional engine.
    """
    board = chess.Board(fen)
    all_findings = []
    
    all_findings.extend(get_bad_bishops(board))
    all_findings.extend(get_isolated_pawns(board))
    all_findings.extend(get_open_files(board))
    all_findings.extend(get_king_safety(board))
    all_findings.extend(get_knight_outposts(board))
    
    return all_findings

if __name__ == "__main__":
    # Test 1: Isolated Queen's Pawn
    test1 = "r1bqk2r/pp2bppp/2n1p3/3pP3/3P4/5N2/PP3PPP/RNBQKB1R w KQkq - 0 1"
    print(f"=== Test 1: Isolated QP ===\nFEN: {test1}")
    for r in analyze_positional_features(test1):
        print(f"  [{r['type']}] {r['square']}: {r['description']}")

    # Test 2: Knight outpost on e5, no enemy d/f pawns to challenge
    test2 = "r1bqkb1r/pppp1ppp/2n5/4N3/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 4"
    print(f"\n=== Test 2: Knight Outpost ===\nFEN: {test2}")
    for r in analyze_positional_features(test2):
        print(f"  [{r['type']}] {r['square']}: {r['description']}")

    # Test 3: Weak color complex — white king on g1, dark-squared bishop traded
    test3 = "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/4P3/3P1N2/PPP2PPP/RNBQ1RK1 w - - 0 6"
    print(f"\n=== Test 3: King Safety ===\nFEN: {test3}")
    for r in analyze_positional_features(test3):
        print(f"  [{r['type']}] {r['square']}: {r['description']}")
