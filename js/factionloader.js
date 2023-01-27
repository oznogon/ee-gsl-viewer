(function(window, luaparse, walker) {
    var path = window.location.href.replace(/([^\/]+)\/([^\/]+)$/, '')
        , script = './lua/factionInfo.lua'
        , ast
        , source
        , factions = {};

    // Get the script, extract the text from the response, then parse it
    fetch(script)
    .then(response => response.text())
    .then(function(data) {
        source = data;
        ast = luaparse.parse(data);

        walker(ast, function(node) {
            let faction_var = "";

            if (node.type === 'CallStatement') {
                if (node.expression.base.identifier.name === 'setGMColor') {
                    faction_var = node.expression.base.base.name;

                    if (!factions[faction_var]) {
                        factions[faction_var] = {};
                    }

                    factions[faction_var].color = {};
                    factions[faction_var].color.r = node.expression.arguments[0].value;
                    factions[faction_var].color.g = node.expression.arguments[1].value;
                    factions[faction_var].color.b = node.expression.arguments[2].value;
                }
            }

            if (node.type === 'AssignmentStatement') {
                if(node.init[0].base.identifier.name === 'setLocaleName') {
                    faction_var = node.variables[0].name;

                    if (!factions[faction_var]) {
                        factions[faction_var] = {};
                    }

                    factions[faction_var].name = node.init[0].arguments[0].arguments[0].raw;
                }
            }
        });
    });

    console.log(factions);
}(this, this.luaparse, this.walker));
