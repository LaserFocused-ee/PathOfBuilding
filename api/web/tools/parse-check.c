/* Parse every Lua file named on the command line with the browser VM's own parser
 * (pob-web's Lua fork, compiled natively). Prints each file that fails and exits 1. */
#include <stdio.h>
#include "lua.h"
#include "lauxlib.h"

int main(int argc, char **argv) {
  lua_State *L = luaL_newstate();
  int failed = 0;
  for (int i = 1; i < argc; i++) {
    if (luaL_loadfile(L, argv[i]) != LUA_OK) {
      fprintf(stderr, "%s\n", lua_tostring(L, -1));
      failed++;
    }
    lua_settop(L, 0);
  }
  lua_close(L);
  printf("parsed %d files, %d failed\n", argc - 1, failed);
  return failed ? 1 : 0;
}
