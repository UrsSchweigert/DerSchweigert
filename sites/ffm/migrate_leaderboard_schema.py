"""
Migration: add first_grade_year and per-user high-score table.

Usage:
    python sites/ffm/migrate_leaderboard_schema.py [path/to/ffm.db]
"""
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent / "ffm.db"
MIN_FIRST_GRADE_YEAR = 1950
MAX_FIRST_GRADE_YEAR = 2100


def table_columns(con: sqlite3.Connection, table_name: str) -> set[str]:
    rows = con.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def migrate(db_path: Path) -> None:
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("BEGIN")

    try:
        user_columns = table_columns(con, "users")
        if "first_grade_year" not in user_columns:
            con.execute("ALTER TABLE users ADD COLUMN first_grade_year INTEGER")

        con.execute(
            "CREATE INDEX IF NOT EXISTS ix_users_first_grade_year ON users(first_grade_year)"
        )

        con.execute(
            f"""
            UPDATE users
            SET first_grade_year = NULL
            WHERE first_grade_year IS NOT NULL
              AND (first_grade_year < {MIN_FIRST_GRADE_YEAR} OR first_grade_year > {MAX_FIRST_GRADE_YEAR})
            """
        )

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS user_high_scores (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id),
                high_score  INTEGER NOT NULL CHECK (high_score >= 0),
                achieved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        con.execute(
            """
            INSERT INTO user_high_scores (user_id, high_score, achieved_at)
            SELECT ls.user_id, ls.score, ls.achieved_at
            FROM level_scores ls
            JOIN (
                SELECT user_id, MAX(score) AS max_score
                FROM level_scores
                GROUP BY user_id
            ) best ON best.user_id = ls.user_id AND best.max_score = ls.score
            LEFT JOIN user_high_scores uhs ON uhs.user_id = ls.user_id
            WHERE uhs.user_id IS NULL
            GROUP BY ls.user_id
            """
        )

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
