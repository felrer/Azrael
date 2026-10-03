use super::*;
use crate::tools::context::ToolCallSource;
use codex_tools::FunctionCallError;
use pretty_assertions::assert_eq;

#[test]
fn tool_message_transport_is_derived_from_the_call_source() {
    let task = "exact delegated task text".to_string();

    let encrypted = agent_message_from_tool(task.clone(), &ToolCallSource::Direct);
    assert!(matches!(encrypted, AgentMessage::Encrypted(message) if message == task));

    let plaintext = agent_message_from_tool(task.clone(), &ToolCallSource::DirectPlaintextMessage);
    assert!(matches!(plaintext, AgentMessage::Plaintext(message) if message == task));
}

#[test]
fn devin_recipient_requires_plaintext_azrael_source() {
    assert_eq!(
        validate_message_recipient("gpt-6-astra", &ToolCallSource::Direct),
        Ok(())
    );
    assert_eq!(
        validate_message_recipient("devin/swe-2-high", &ToolCallSource::DirectPlaintextMessage,),
        Ok(())
    );

    let error = validate_message_recipient("devin/swe-2-high", &ToolCallSource::Direct)
        .expect_err("encrypted native content must not be transferred to Devin");
    let FunctionCallError::RespondToModel(message) = error else {
        panic!("unexpected validation error: {error:?}");
    };
    assert_eq!(
        message,
        "Devin requires a plaintext task through azrael_agents; encrypted native task content cannot be transferred."
    );
}
