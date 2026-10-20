cmake_minimum_required(VERSION 3.16)
project(phishguard_wasm CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# -ffp-contract=off: never fuse a*b+c into FMA, so float results match Python bit-for-bit.
add_compile_options(-Wall -Wextra -Werror -ffp-contract=off)

set(PG_SOURCES src/json.cpp src/detmath.cpp src/url.cpp src/psl.cpp src/lookalike.cpp src/bloom.cpp src/features.cpp)
add_library(phishguard STATIC ${PG_SOURCES})
target_include_directories(phishguard PUBLIC include)

add_executable(pg_cli tools/pg_cli.cpp)
target_link_libraries(pg_cli phishguard)

option(PG_BUILD_TESTS "Build unit tests" ON)
option(PG_USE_MINIGTEST "Use the vendored minimal gtest shim (offline builds only)" OFF)

if(PG_BUILD_TESTS)
  enable_testing()
  file(GLOB PG_TEST_SOURCES tests/*_test.cpp)
  add_executable(pg_tests ${PG_TEST_SOURCES})
  target_compile_definitions(pg_tests PRIVATE PG_SHARED_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../shared")
  if(PG_USE_MINIGTEST)
    target_sources(pg_tests PRIVATE third_party/minigtest/gtest_main.cpp)
    target_include_directories(pg_tests PRIVATE third_party/minigtest)
    target_link_libraries(pg_tests phishguard)
  else()
    find_package(GTest QUIET)
    if(NOT GTest_FOUND)
      include(FetchContent)
      FetchContent_Declare(googletest
        URL https://github.com/google/googletest/archive/refs/tags/v1.15.2.tar.gz)
      set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
      FetchContent_MakeAvailable(googletest)
    endif()
    target_link_libraries(pg_tests phishguard GTest::gtest_main)
  endif()
  add_test(NAME pg_tests COMMAND pg_tests)
endif()
