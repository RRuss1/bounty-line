std = "lua51"
max_line_length = 140
exclude_files = { "addon/BountyLine/Libs/" }

files["addon/tests/"] = { std = "lua51+luajit" }

-- WoW API globals are added here as the addon grows.
read_globals = {}
