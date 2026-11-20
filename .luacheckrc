std = "lua51"
max_line_length = 140
exclude_files = { "addon/BountyLine/Libs/" }

-- The test runner installs the WoW globals LibStub needs.
files["addon/tests/"] = { std = "lua51+luajit", globals = { "strmatch", "LibStub" } }

-- WoW API globals are added here as the addon grows.
read_globals = { "LibStub" }
