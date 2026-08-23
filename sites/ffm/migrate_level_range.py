"""
Migration: expand check_level_range constraint from <= 40 to <= 60.

SQLite does not support ALTER TABLE DROP CONSTRAINT, so this script recreates
the level_scores table with the updated constraint.

Usage:
    python sites/ffm/migrate_level_range.py [path/to/ffm.db]

Defaults to sites/ffm/ffm.db if no path is given.
"""
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent / "ffm.db"


def migrate(db_path: Path) -> None:
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("BEGIN")

    try:
        con.execute("""
            CREATE TABLE level_scores_new (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id),
                level       INTEGER NOT NULL CHECK (level >= 1 AND level <= 60),
                score       INTEGER NOT NULL CHECK (score >= 0),
                difficulty  TEXT    NOT NULL,
                achieved_at DATETIME NOT NULL,
                CONSTRAINT uq_user_level_difficulty UNIQUE (user_id, level, difficulty)
            )
        """)
        con.execute("""
            INSERT INTO level_scores_new
            SELECT id, user_id, level, score, difficulty, achieved_at
            FROM level_scores
        """)
        con.execute("DROP TABLE level_scores")
        con.execute("ALTER TABLE level_scores_new RENAME TO level_scores")
        con.execute("COMMIT")
        print(f"Migration complete: {db_path}")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.execute("PRAGMA foreign_keys = ON")
        con.close()


if __name__ == "__main__":
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DB_PATH
    if not path.exists():
        print(f"Database not found: {path}")
        sys.exit(1)
    migrate(path)
