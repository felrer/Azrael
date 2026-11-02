#include "broker.hpp"
#include <iostream>
#include <set>

int main(){
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  vi::Broker broker;
  // Bound each line before parsing; malformed input never reaches the broker.
  while(!broker.shutdown){
    std::string line;bool tooLong=false;char c;
    while(std::cin.get(c)&&c!='\n'){if(line.size()<65536)line.push_back(c);else tooLong=true;}
    if(line.empty()&&!tooLong&&!std::cin)break;
    vi::Json response;
    try{
      if(tooLong)throw std::runtime_error("Request exceeds 65536 bytes");
      vi::Wide(line);
      // Duplicate object keys are rejected instead of silently overwriting a binding.
      std::vector<std::set<std::string>> objects;
      auto callback=[&](int,vi::Json::parse_event_t event,vi::Json& value){
        if(event==vi::Json::parse_event_t::object_start)objects.emplace_back();
        else if(event==vi::Json::parse_event_t::key){if(!objects.back().insert(value.get<std::string>()).second)throw std::runtime_error("Duplicate object key");}
        else if(event==vi::Json::parse_event_t::object_end)objects.pop_back();return true;
      };
      response=broker.invoke(vi::Json::parse(line,callback));
    }catch(const std::exception& e){response={{"id",nullptr},{"error",{{"code","invalid_json"},{"message",e.what()},{"mutationOutcome","none"}}}};}
    std::cout<<response.dump()<<'\n'<<std::flush;
  }
  try{broker.detach();}catch(const std::exception& e){std::cerr<<"Cleanup not confirmed: "<<e.what()<<'\n';return 2;}
  return 0;
}
