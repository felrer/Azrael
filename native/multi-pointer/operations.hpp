#pragma once
#include "platform.hpp"
#include <deque>
#include <map>

namespace mp {
struct Operation {
    uint64_t id = 0;
    std::string fingerprint;
    json outcome = nullptr;
    unsigned rounds = 0;
    uint64_t activeRecoveryMs = 0, applicationInputs = 0;
    uint64_t deliveredInputs = 0, activationInputs = 0;
    bool actionExecuted = false;
    bool exhausted = false;
    bool preparing = false, uncertain = false, observeRequired = false, captionAttempted = false;
    bool intentPinned = false;
    POINT intentPoint{};
    RECT intentClient{};
    std::string lastBlocker;
    json status() const {
        return {{"operationId",id},{"rounds",rounds},{"maxRounds",3},{"activeRecoveryMs",activeRecoveryMs},{"maxActiveRecoveryMs",5000},
            {"applicationInputs",applicationInputs},{"observeRequired",observeRequired},{"uncertainDelivery",uncertain},
            {"lastBlocker",lastBlocker},{"budgetExhausted",exhausted},{"completed",!outcome.is_null()}};
    }
};
class Operations {
    static constexpr uint64_t maxId = 9007199254740991ULL;
    uint64_t highWatermark = 0;
    std::map<uint64_t,std::shared_ptr<Operation>> retained;
    std::deque<uint64_t> order;
    static uint64_t safeId(const json& value) {
        if (value.is_number_unsigned()) {
            const auto n = value.get<uint64_t>(); return n > 0 && n <= maxId ? n : 0;
        }
        if (value.is_number_integer()) {
            const auto n = value.get<int64_t>(); return n > 0 && static_cast<uint64_t>(n) <= maxId ? static_cast<uint64_t>(n) : 0;
        }
        return 0;
    }
public:
    std::pair<std::shared_ptr<Operation>,bool> admit(const std::string& method, const json& params, const json& requestId) {
        uint64_t id = 0;
        if (params.contains("operationId")) {
            id = safeId(params.at("operationId")); require(id != 0,"invalid_params","operationId must be a positive safe integer");
        } else {
            id = safeId(requestId);
            if (!id) { require(highWatermark < maxId,"operation_id_exhausted","Operation identity space exhausted"); id = highWatermark + 1; }
        }
        json intent = params; intent.erase("operationId");
        const auto fingerprint = json{{"method",method},{"params",intent}}.dump();
        const auto found = retained.find(id);
        if (found != retained.end()) {
            require(found->second->fingerprint == fingerprint,"operation_conflict","operationId was already admitted with different intent");
            return {found->second,false};
        }
        require(id > highWatermark,"retired_operation","Operation identity has retired; mutation is never replayed");
        auto operation = std::make_shared<Operation>(); operation->id=id; operation->fingerprint=fingerprint;
        highWatermark=id; retained.emplace(id,operation); order.push_back(id);
        while (order.size()>64) { retained.erase(order.front()); order.pop_front(); }
        return {operation,true};
    }
    json status() const { return {{"admittedHighWatermark",highWatermark},{"retainedOutcomes",retained.size()},{"retentionLimit",64}}; }
};
} // namespace mp
