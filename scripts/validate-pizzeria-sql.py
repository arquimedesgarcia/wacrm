"""Valida sintaxis SQL de las migraciones pizzería y el script standalone.

- pglast.parse_sql valida el SQL estandar (CREATE/INSERT/ALTER...).
- pglast.parse_plpgsql valida el cuerpo de los bloques DO / funciones PL/pgSQL.
"""
import re
import sys

import pglast

FILES = [
    r"D:\Proyectos\flowCRM\code\supabase\migrations\050_pizzeria_schema.sql",
    r"D:\Proyectos\flowCRM\code\supabase\migrations\051_pizzeria_seed_data.sql",
    r"D:\Proyectos\flowCRM\code\supabase\migrations\052_pizzeria_knowledge_extension.sql",
    r"D:\Proyectos\flowCRM\code\supabase\migrations\053_pizzeria_kb_seed.sql",
    r"D:\Proyectos\flowCRM\code\supabase\migrations\054_pizzeria_flows_and_aiconfig.sql",
    r"D:\Proyectos\flowCRM\code\scripts\pizzeria-simulation.sql",
]

errors = 0
for path in FILES:
    sql = open(path, encoding="utf-8").read()
    name = path.split("\\")[-1]
    # 1) SQL completo
    try:
        pglast.parse_sql(sql)
        print(f"[OK]   {name}: SQL")
    except Exception as e:  # noqa: BLE001
        errors += 1
        print(f"[FAIL] {name}: SQL -> {e}")
    # 2) Cuerpos PL/pgSQL de cada bloque DO ... <tag>$ ... <tag>$
    #    parse_plpgsql espera un CREATE FUNCTION completo: envolvemos el body.
    for i, m in enumerate(re.finditer(r"\bDO\s+(?:\$[\w]*\$)(.*?)\$[\w]*\$", sql, re.S)):
        body = m.group(1)
        wrapped = (
            "CREATE FUNCTION _validate_body() RETURNS void "
            f"AS $wb${body}$wb$ LANGUAGE plpgsql"
        )
        try:
            pglast.parse_plpgsql(wrapped)
            print(f"[OK]   {name}: DO block #{i + 1} (PL/pgSQL)")
        except Exception as e:  # noqa: BLE001
            errors += 1
            print(f"[FAIL] {name}: DO block #{i + 1} (PL/pgSQL) -> {e}")

sys.exit(1 if errors else 0)
